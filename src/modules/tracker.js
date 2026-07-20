import { getSettings } from './core.js';
import { getTrackedCharacters } from './trackedCharacters.js';

export function initTracker() {
    try {
        const s = getSettings();
        const $body = $("#uie-tracker-body");
        if (!$body.length) return;
        $body.empty();

        const trackedList = getTrackedCharacters(s);

        /* Shared tracking rules are defined in trackedCharacters.js. Party is
           automatic; social contacts are included only when mapTracked is on. */
        /*
        // Identify current protagonist name to filter out active player and other characters
        const activeCharName = String(s.character?.name || s.name || "").toLowerCase().trim();

        // 1. Gather Away Party Members
        const partyMembers = s.party?.members || [];
        for (const member of partyMembers) {
            if (!member || !member.name) continue;
            const memName = member.name.trim();
            const memNameLower = memName.toLowerCase();
            
            // Skip the active player or empty names
            if (memNameLower === activeCharName) continue;

            const memLoc = member.location || "Unknown";
            if (!seenNames.has(memNameLower)) {
                trackedList.push({
                    name: memName,
                    category: "party",
                    categoryLabel: "Party Member",
                    role: member.role || "Companion",
                    location: memLoc,
                    affinity: Number.isFinite(member.affinity) ? member.affinity : 50,
                    avatar: member.avatar || member.url || "",
                    birthday: member.birthday || "Spring 14",
                    likes: member.likes || "",
                    dislikes: member.dislikes || "",
                    color: "#6fd3ff"
                });
                seenNames.add(memNameLower);
            }
        }

        // 2. Gather Friends, Family, Romance, Rivals, Associates from Social settings
        const socialCategories = {
            romance: { label: "Romance Status", color: "#f43f5e" },
            family: { label: "Family Tie", color: "#a855f7" },
            friends: { label: "Friend", color: "#10b981" },
            associates: { label: "Associate", color: "#38bdf8" },
            rivals: { label: "Rival", color: "#e67e22" }
        };

        if (s.social && typeof s.social === "object") {
            for (const [cat, meta] of Object.entries(socialCategories)) {
                const list = s.social[cat] || [];
                for (const p of list) {
                    if (!p || !p.name) continue;
                    const pName = p.name.trim();
                    const pNameLower = pName.toLowerCase();

                    // Skip the active player or empty names
                    if (pNameLower === activeCharName) continue;

                    const pLoc = p.location || "Unknown";
                    
                    if (!seenNames.has(pNameLower)) {
                        trackedList.push({
                            name: pName,
                            category: cat,
                            categoryLabel: meta.label,
                            role: p.familyRole || p.relationshipStatus || "Contact",
                            location: pLoc,
                            affinity: Number.isFinite(p.affinity) ? p.affinity : 50,
                            avatar: p.avatar || p.url || "",
                            birthday: p.birthday || "Summer 08",
                            likes: p.likes || "",
                            dislikes: p.dislikes || "",
                            color: meta.color
                        });
                        seenNames.add(pNameLower);
                    }
                }
            }
        }

        */
        if (trackedList.length === 0) {
            $body.html(`
                <div class="tracker-empty-state">
                    <i class="fa-solid fa-user-group"></i>
                    <div>No social contacts or friends found yet.</div>
                    <div style="font-size:0.85em; opacity:0.7;">Acquaintances and companions will appear in this chronicle.</div>
                </div>
            `);
            return;
        }

        // Render Cozy Horizontal Cards
        for (const char of trackedList) {
            // 10-heart affinity bar: 1 heart per 10% affinity
            const heartsCount = Math.min(10, Math.max(0, Math.floor(char.affinity / 10)));
            let heartsHtml = "";
            for (let i = 1; i <= 10; i++) {
                if (i <= heartsCount) {
                    heartsHtml += '<i class="fa-solid fa-heart" style="color:#e74c3c; margin-right:1px;"></i>';
                } else {
                    heartsHtml += '<i class="fa-regular fa-heart" style="color:#bdc3c7; margin-right:1px;"></i>';
                }
            }

            const avatarHtml = char.avatar ? 
                 `<img class="tracker-avatar" src="${char.avatar}" alt="${esc(char.name)}">`
                : `<div class="tracker-avatar" style="display:grid; place-items:center; font-size:2em; color:#8b5a2b; background:#fff;"><i class="fa-solid fa-user"></i></div>`;

            const card = $(`
                <div class="tracker-card" data-name="${esc(char.name)}">
                    <div class="tracker-avatar-wrapper">
                        ${avatarHtml}
                    </div>
                    <div class="tracker-info">
                        <div class="tracker-details-block">
                            <div class="tracker-name">${esc(char.name)}</div>
                            <div class="tracker-badges">
                                <span class="tracker-badge" style="background:rgba(${hexToRgb(char.color)}, 0.15); color:${char.color}; border-color:${char.color};">
                                    ${esc(char.categoryLabel)}
                                </span>
                                ${char.role ? `
                                <span class="tracker-badge" style="background:rgba(74,44,17,0.1); color:#4a2c11; border-color:#8b5a2b;">
                                    ${esc(char.role)}
                                </span>` : ''}
                            </div>
                            <div class="tracker-location">
                                <i class="fa-solid fa-location-dot"></i>
                                <span>${esc(char.withPlayer ? `${char.location} · with you` : char.location)}</span>
                            </div>
                        </div>
                        <div class="tracker-affinity-meter">
                            <div class="tracker-hearts" title="Relationship Affinity: ${char.affinity}%">${heartsHtml}</div>
                            <span class="tracker-affinity-pct">${char.affinity}% Affinity</span>
                        </div>
                        <div class="tracker-actions">
                            <button class="tracker-map-btn tracker-nav-btn" data-location="${esc(char.location)}" data-character="${esc(char.name)}">
                                <i class="fa-solid fa-location-crosshairs"></i> Show on Map
                            </button>
                            <button class="tracker-nav-btn" data-name="${esc(char.name)}">
                                <i class="fa-solid fa-address-card"></i> Profile Details
                            </button>
                        </div>
                    </div>
                </div>
            `);

            // Store the full details in jquery data to access on profile click
            card.find(".tracker-nav-btn").data("char-details", char);
            $body.append(card);
        }

        // Bind 'View Profile' click listeners
        $body.find(".tracker-nav-btn").not(".tracker-map-btn").off("click").on("click", function(e) {
            e.preventDefault();
            e.stopPropagation();
            const char = $(this).data("char-details");
            if (!char) return;
            
            // Populate Cozy Details Overlay
            const detailsOverlay = $("#uie-social-details-overlay");
            
            if (char.avatar) {
                $("#sd-details-avatar").attr("src", char.avatar).show();
            } else {
                $("#sd-details-avatar").hide();
            }
            
            $("#sd-details-name").text(char.name);
            $("#sd-details-relation-badge").text(char.categoryLabel).css({
                background: char.color,
                borderColor: char.color
            });
            $("#sd-details-role-badge").text(char.role || "Contact");
            $("#sd-details-birthday").text(char.birthday || "Spring 14");
            $("#sd-details-location").text(char.location || "Unknown Location");
            
            // Parse likes/dislikes for Stardew gifts
            const likesArr = String(char.likes || "").split(",").map(x => x.trim()).filter(Boolean);
            const dislikesArr = String(char.dislikes || "").split(",").map(x => x.trim()).filter(Boolean);
            
            const loves = likesArr.slice(0, 2).join(", ") || "Sweet pastries, Acoustic music";
            const likes = likesArr.slice(2).join(", ") || "Wild honey, Daffodils";
            const dislikes = dislikesArr.slice(0, 2).join(", ") || "Loud machinery, Anchovies";
            const hates = dislikesArr.slice(2).join(", ") || "Rusty keys, Sap";
            
            $("#sd-details-loves").text(loves);
            $("#sd-details-likes").text(likes);
            $("#sd-details-dislikes").text(dislikes);
            $("#sd-details-hates").text(hates);
            
            // Bind view family tree button
            $("#sd-details-tree-btn").off("click").on("click", function() {
                if (typeof window.renderFamilyTreeOverlay === "function") {
                    window.renderFamilyTreeOverlay(char.name);
                    $("#uie-family-tree-overlay").fadeIn(200);
                } else {
                    alert("Family tree lineage system is loading. Try again shortly!");
                }
            });
            
            detailsOverlay.fadeIn(200);
        });

        $body.find(".tracker-map-btn").off("click").on("click", async function(e) {
            e.preventDefault();
            e.stopPropagation();
            const location = String($(this).attr("data-location") || "").trim();
            const characterName = String($(this).attr("data-character") || "").trim();
            const map = window.importUieModule ? await window.importUieModule("map.js") : await import("./map.js");
            const ok = await map.focusTrackedLocation?.(location, { characterName });
            if (!ok) window.showToast?.(`${characterName}'s location is not on the map yet.`, 4200);
        });

    } catch (err) {
        console.error("[Tracker] initTracker failed:", err);
    }
}

// Helper to escape HTML characters
function esc(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Helper to convert hex to rgb for background opacity
function hexToRgb(hex) {
    hex = String(hex).replace(/^#/, "");
    if (hex.length === 3) {
        hex = hex.split("").map(c => c + c).join("");
    }
    const num = parseInt(hex, 16);
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
}

// Bind Close Button once the template is loaded
$(document).on("click", "#uie-tracker-close", function(e) {
    e.preventDefault();
    $("#uie-tracker-window").fadeOut(150);
});

$(document).on("click", "#uie-social-details-close", function(e) {
    e.preventDefault();
    $("#uie-social-details-overlay").fadeOut(150);
});

$(document).on("click", "#uie-family-tree-close", function(e) {
    e.preventDefault();
    $("#uie-family-tree-overlay").fadeOut(150);
});
