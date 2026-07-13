/**
 * taxJailManager.js — Tax, Billing, and Jail/Prison Systems
 * 
 * Manages player jobs, taxes, annual tax refunds, primary home registration, recurring bills, 
 * and jail arrests/trials/sentencing, integrated with calendar date rollover and map travel.
 */

import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { injectRpEvent } from "./features/rp_log.js";
import { resolveUiTheme } from "./gameModeManager.js";
import { addCurrency, spendCurrency } from "./economy.js";

// Helper to determine year length
function getYearLength(s) {
    if (s.calendar && s.calendar.mode === "fantasy" && s.calendar.fantasy?.seasons) {
        return s.calendar.fantasy.seasons.reduce((sum, season) => sum + Number(season.days || 0), 0);
    }
    return 365;
}

// Ensures all relevant states exist on settings load
export function ensureTaxJailState(s = getSettings()) {
    // 1. RPG Settings defaults
    if (!s.rpg || typeof s.rpg !== "object") s.rpg = {};
    if (typeof s.rpg.taxSystemEnabled !== "boolean") s.rpg.taxSystemEnabled = true;
    if (typeof s.rpg.fantasyTaxEnabled !== "boolean") s.rpg.fantasyTaxEnabled = true;

    // 2. Active Job State
    if (s.activeJob === undefined) s.activeJob = null; // null means unemployed

    // 3. Tax Refund State
    if (!s.taxRefundState || typeof s.taxRefundState !== "object") {
        s.taxRefundState = {
            taxesPaidThisYear: 0,
            lastRefundAbsoluteDay: Number(s.playerRoom?.day || 1)
        };
    }

    // 4. Jail State
    if (!s.jailState || typeof s.jailState !== "object") {
        s.jailState = {
            arrested: false,
            sentenceDays: 0,
            daysServed: 0,
            trialDay: 0,
            trialPending: false,
            prisonNodeId: "",
            prisonNodeName: "",
            originalLocation: ""
        };
    }

    // 5. Primary Home State
    if (!s.primaryHome || typeof s.primaryHome !== "object") {
        s.primaryHome = {
            id: "",
            name: "",
            lastBilledDay: Number(s.playerRoom?.day || 1),
            bills: []
        };
    }
    if (!Array.isArray(s.primaryHome.bills)) {
        s.primaryHome.bills = [];
    }

    return s;
}

// Determines if player should pay taxes based on RPG settings and active theme
export function shouldPlayerPayTax(s = getSettings()) {
    ensureTaxJailState(s);
    if (s.rpg.taxSystemEnabled === false) return false;

    const theme = resolveUiTheme(s);
    if (theme === "fantasy" && s.rpg.fantasyTaxEnabled === false) {
        return false;
    }
    return true;
}

// Processes daily ticks (triggered by advanceRpDays)
export function processDailyTaxJailTick(s = getSettings(), deltaDays = 1) {
    ensureTaxJailState(s);
    const currentDay = Math.max(1, Number(s.playerRoom?.day || 1));

    // Process daily loops for each day advanced
    for (let d = 0; d < deltaDays; d++) {
        const simulatedDay = currentDay - deltaDays + 1 + d;

        // 1. Jail Serving Tick
        if (s.jailState.arrested) {
            s.jailState.daysServed++;
            
            // Check if served sentence is completed
            if (s.jailState.daysServed >= s.jailState.sentenceDays) {
                releasePlayer(s);
            }
            
            // Check if today is the trial date
            if (s.jailState.trialPending && simulatedDay >= s.jailState.trialDay) {
                s.jailState.trialPending = false;
                const heat = s.governorRules?.heatLevel || 0;
                let verdict = "sentenced to serve " + s.jailState.sentenceDays + " days";
                
                if (heat <= 1) {
                    verdict = "acquitted of all charges due to insufficient evidence";
                    releasePlayer(s);
                } else if (heat >= 4) {
                    verdict = "condemned to the gallows (death sentence) - you must find a way to escape tonight";
                }
                
                injectRpEvent(`[System Event: Trial Date. Today you are escorted to the court for your trial. Based on your crime record and standing, the judge has rendered a verdict: you are ${verdict}. Narrate this courtroom scene.]`);
                notify("info", "Court Trial has commenced today!", "Jail");
            }
        }

        // 2. Active Job Income & Taxes
        if (s.activeJob && !s.jailState.arrested) {
            const salary = Number(s.activeJob.salary || 0);
            const paysTax = shouldPlayerPayTax(s);
            
            if (paysTax) {
                const taxRate = Number(s.activeJob.taxRate || 0.15);
                const taxAmount = Math.round(salary * taxRate);
                const netIncome = salary - taxAmount;
                
                addCurrency(s, netIncome);
                s.taxRefundState.taxesPaidThisYear += taxAmount;
                
                injectRpEvent(`[System: Paid daily salary of ${netIncome} ${s.currencySymbol || "G"} (Gross: ${salary}, Income Tax: ${taxAmount} paid automatically).]`);
            } else {
                addCurrency(s, salary);
                injectRpEvent(`[System: Paid daily salary of ${salary} ${s.currencySymbol || "G"} (Taxes bypassed by RPG settings).]`);
            }
        }

        // 3. Annual Tax Refund Crossing
        const yearLength = getYearLength(s);
        const lastRefund = Number(s.taxRefundState.lastRefundAbsoluteDay || 0);
        if (simulatedDay - lastRefund >= yearLength) {
            const taxesPaid = Number(s.taxRefundState.taxesPaidThisYear || 0);
            const refundRate = 0.35; // 35% refund rate
            const refundAmount = Math.round(taxesPaid * refundRate);
            
            if (refundAmount > 0) {
                addCurrency(s, refundAmount);
                notify("success", `Annual tax refund of ${refundAmount} ${s.currencySymbol || "G"} automatically deposited!`, "Tax Refund");
                injectRpEvent(`[System Event: Annual Tax Refund. You received a refund of ${refundAmount} ${s.currencySymbol || "G"} based on your taxes paid (${taxesPaid} G) over the past year. This was processed automatically.]`);
            }
            
            s.taxRefundState.taxesPaidThisYear = 0;
            s.taxRefundState.lastRefundAbsoluteDay = simulatedDay;
        }

        // 4. Primary Home Bills Generation (Every 30 days)
        if (s.primaryHome && s.primaryHome.name) {
            const lastBilled = Number(s.primaryHome.lastBilledDay || 0);
            if (simulatedDay - lastBilled >= 30) {
                s.primaryHome.lastBilledDay = simulatedDay;
                
                // Generate 3 standard bills
                const rentAmount = 80;
                const utilityAmount = 30;
                const maintAmount = 15;
                
                const billDueDay = simulatedDay + 10; // due in 10 days
                
                s.primaryHome.bills.push(
                    { id: `bill_rent_${Date.now()}_${d}`, name: "Rent / Property Tax", amount: rentAmount, dueDay: billDueDay, status: "unpaid" },
                    { id: `bill_util_${Date.now()}_${d}`, name: "Power & Water Utilities", amount: utilityAmount, dueDay: billDueDay, status: "unpaid" },
                    { id: `bill_maint_${Date.now()}_${d}`, name: "Home Maintenance", amount: maintAmount, dueDay: billDueDay, status: "unpaid" }
                );
                
                notify("warning", `New billing cycle invoice issued for primary home ${s.primaryHome.name}.`, "Bills");
                injectRpEvent(`[System: Invoices issued for ${s.primaryHome.name}. Due on Day ${billDueDay}. Pay them via the phone banking app to avoid utility cutoff.]`);
            }
            
            // Check for unpaid overdue bills (older than due date) and apply penalties
            const unpaidOverdue = s.primaryHome.bills.filter(b => b.status === "unpaid" && simulatedDay > b.dueDay);
            if (unpaidOverdue.length > 0 && simulatedDay % 5 === 0) { // warn every 5 days
                const penalty = unpaidOverdue.length * 5;
                if (spendCurrency(s, penalty)) {
                    injectRpEvent(`[System Warning: Overdue bills on your primary home. Late fees of ${penalty} ${s.currencySymbol || "G"} charged to checking account.]`);
                }
            }
        }
    }

    saveSettings();
}

// Designates any map location as the player's primary home
export function setPrimaryHome(nodeId, nodeName, details = {}) {
    const s = getSettings();
    ensureTaxJailState(s);
    const currentDay = Math.max(1, Number(s.playerRoom?.day || 1));
    const previousId = String(s.primaryHome.id || "");
    const previousName = String(s.primaryHome.name || "");
    
    s.primaryHome.id = String(nodeId);
    s.primaryHome.name = String(nodeName);
    s.primaryHome.nodeView = String(details.view || details.nodeView || "");
    s.primaryHome.nodeType = String(details.type || details.nodeType || "");
    s.primaryHome.description = String(details.description || "").slice(0, 240);
    s.primaryHome.establishedDay = currentDay;
    s.primaryHome.lastVisitedDay = currentDay;
    s.primaryHome.previousName = previousName;
    s.primaryHome.relocationCount = previousId && previousId !== String(nodeId)
        ? Number(s.primaryHome.relocationCount || 0) + 1
        : Number(s.primaryHome.relocationCount || 0);
    s.primaryHome.lastBilledDay = currentDay;
    s.primaryHome.bills = []; // Reset bills for the new home
    
    saveSettings();
    notify("success", `${nodeName} is now your primary home and return anchor.`, "Primary Home");
    injectRpEvent(`[System: You designated ${nodeName} as your primary residence and return anchor. Bills, property tax, and home notices will be registered to this location.]`);
}

// Pays an outstanding bill
export function payBill(billId) {
    const s = getSettings();
    ensureTaxJailState(s);
    
    const bill = s.primaryHome.bills.find(b => b.id === billId && b.status === "unpaid");
    if (!bill) return { ok: false, reason: "Bill not found or already paid." };
    
    const amount = Number(bill.amount);
    if (!spendCurrency(s, amount)) {
        return { ok: false, reason: "Insufficient checking funds to pay this bill." };
    }
    
    bill.status = "paid";
    
    // Add transaction to bank history if bank exists
    if (s.phone && s.phone.bank) {
        if (!Array.isArray(s.phone.bank.history)) s.phone.bank.history = [];
        s.phone.bank.history.unshift({ title: `Paid Bill: ${bill.name}`, amount, t: Date.now() });
        s.phone.bank.history = s.phone.bank.history.slice(0, 60);
    }
    
    saveSettings();
    notify("success", `Paid bill: ${bill.name} (${amount} ${s.currencySymbol || "G"})`, "Bills");
    injectRpEvent(`[System: Successfully paid bill "${bill.name}" for ${amount} ${s.currencySymbol || "G"}.]`);
    return { ok: true };
}

// Simulates player arrest and relocates them to a genre-specific jail/prison
export function arrestPlayer(s = getSettings(), reason = "crimes committed") {
    ensureTaxJailState(s);
    
    const currentDay = Math.max(1, Number(s.playerRoom?.day || 1));
    const prevLocation = String(s.worldState?.location || "Street").trim();
    
    // Determine prison node details depending on UI Theme
    const theme = resolveUiTheme(s);
    let prisonName = "City Jail";
    let prisonDesc = "A secure modern lockup cell with iron bars, concrete walls, and basic bunk bed.";
    let prisonLaws = ["No weapons", "Confinement", "Curfew"];
    
    if (theme === "fantasy") {
        prisonName = "Royal Dungeon";
        prisonDesc = "A dark, damp dungeon deep below the castle fortress. Torches flicker against moldy stone walls.";
        prisonLaws = ["No weapons", "No magic casting", "Imprisonment"];
    } else if (theme === "futuristic") {
        prisonName = "Neural Detention Cell";
        prisonDesc = "A high-tech containment cell with laser security grids and neural dampening energy fields.";
        prisonLaws = ["No weapons", "No cybernetic access", "Neural lock"];
    } else if (theme === "academic") {
        prisonName = "Disciplinary Detention Hall";
        prisonDesc = "A locked detention room with desks, monitored by strict campus security supervisors.";
        prisonLaws = ["No talking", "Studying mandated", "No leaving room"];
    }

    // 1. Check if the prison node exists in s.simpleMap or local area map
    let mapNode = null;
    if (s.simpleMap && Array.isArray(s.simpleMap.area)) {
        mapNode = s.simpleMap.area.find(n => n.name === prisonName);
        if (!mapNode) {
            // Generate prison node dynamically
            const id = `area_prison_${Date.now().toString(16)}`;
            mapNode = {
                id,
                name: prisonName,
                type: "prison",
                desc: prisonDesc,
                faction: "Law Enforcement",
                theme: theme === "fantasy" ? "Medieval" : theme === "futuristic" ? "Cyberpunk" : "Government",
                laws: prisonLaws,
                reputation: ["Hostile", "Secured"],
                x: 10, // Isolated coordinates
                y: 90,
                z: 0,
                links: [],
                blueprintId: prisonName,
                accessModes: ["foot"]
            };
            s.simpleMap.area.push(mapNode);
        }
    }

    // 2. Set jailState parameters
    s.jailState.arrested = true;
    s.jailState.sentenceDays = 5; // Default sentence of 5 days
    s.jailState.daysServed = 0;
    s.jailState.prisonNodeId = mapNode ? mapNode.id : "prison_node";
    s.jailState.prisonNodeName = prisonName;
    s.jailState.originalLocation = prevLocation;
    s.jailState.trialDay = currentDay + 3; // Trial in 3 days
    s.jailState.trialPending = true;

    // 3. Teleport player to the prison
    s.worldState.location = prisonName;
    s.worldState.currentLocation = prisonName;
    s.worldState.x = mapNode ? mapNode.x : 10;
    s.worldState.y = mapNode ? mapNode.y : 90;
    if (s.playerRoom) {
        s.playerRoom.name = prisonName;
    }

    // 4. Register trial on the calendar
    if (s.calendar && s.calendar.events) {
        // Calculate date key for currentDay + 3
        const targetDay = currentDay + 3;
        let dateKey = `D${targetDay}`;
        if (s.calendar.mode === "fantasy" && typeof getFantasyDateFromAbsoluteDay === "function") {
            try {
                const fd = getFantasyDateFromAbsoluteDay(s, targetDay);
                dateKey = `${fd.year}-${fd.seasonIndex}-${fd.dayOfSeason}`;
            } catch (_) {}
        }
        
        if (!s.calendar.events[dateKey]) s.calendar.events[dateKey] = [];
        s.calendar.events[dateKey].push({
            id: `trial_${Date.now()}`,
            title: "Court Trial Date",
            description: `Scheduled court trial regarding your crime record. Verdict will be delivered by the judge.`,
            time: "10:00 AM",
            reminder: true
        });
    }

    // Lock exits
    window.UIE_exitsLocked = true;

    saveSettings();

    notify("error", `You have been arrested for ${reason}! Transported to ${prisonName}.`, "Arrested");
    
    // Injected AI override
    const promptOverride = `[System Event: Player is ARRESTED due to ${reason}. Teleported to ${prisonName}. Exits are sealed. A court trial is scheduled in 3 days. Player cannot leave. Narrate the arrest and confinement.]`;
    try {
        if (typeof window.UIE_injectPromptOverride === "function") {
            window.UIE_injectPromptOverride(promptOverride);
        }
    } catch (_) {}
    injectRpEvent(`[System Event: Player arrested for ${reason}. Sent to ${prisonName} (Sentence: 5 days, Trial Day: ${s.jailState.trialDay}). Exits locked.]`);
}

// Releases the player from prison
export function releasePlayer(s = getSettings()) {
    ensureTaxJailState(s);
    if (!s.jailState.arrested) return;
    
    s.jailState.arrested = false;
    window.UIE_exitsLocked = false;
    
    // Clear heat/wanted status
    if (s.governorRules) {
        s.governorRules.heatLevel = 0;
    }
    
    // Teleport back
    const targetDest = s.jailState.originalLocation || "Street";
    s.worldState.location = targetDest;
    s.worldState.currentLocation = targetDest;
    if (s.playerRoom) {
        s.playerRoom.name = targetDest;
    }
    
    saveSettings();
    
    notify("success", "You have served your sentence and are released from prison.", "Released");
    injectRpEvent(`[System: Sentence completed. You are released from confinement and escorted back to ${targetDest}. Heat level reset to Clean.]`);
}

// Escapes the player from prison (breakout)
export function escapePlayer(s = getSettings()) {
    ensureTaxJailState(s);
    if (!s.jailState.arrested) return;

    s.jailState.arrested = false;
    window.UIE_exitsLocked = false;

    // Heat becomes wanted / hunted
    if (s.governorRules) {
        s.governorRules.heatLevel = 4; // Wanted / Hunted
    }

    // Teleport out of jail to a neighboring node or general area
    const targetDest = s.jailState.originalLocation || "Street";
    s.worldState.location = targetDest;
    s.worldState.currentLocation = targetDest;
    if (s.playerRoom) {
        s.playerRoom.name = targetDest;
    }

    saveSettings();

    notify("success", "Jailbreak successful! You escaped prison, but you are now Wanted!", "Escaped");
    injectRpEvent(`[System: Player broke out of jail! Travel locks disabled, but heat level increased to HUNTED. Police/Guards are searching for you.]`);
}
