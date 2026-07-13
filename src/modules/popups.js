import { getSettings } from "./core.js";

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function showPopup(title, content, options = {}) {
    const settings = getSettings();
    
    // Create popup container if it doesn't exist
    if (!document.getElementById('uie-popup-container')) {
        const container = document.createElement('div');
        container.id = 'uie-popup-container';
        container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 2147483646;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        document.body.appendChild(container);
    }

    const container = document.getElementById('uie-popup-container');
    
    // Create popup
    const popup = document.createElement('div');
    popup.style.cssText = `
        background: rgba(15, 10, 10, 0.96);
        border: 1px solid rgba(203, 163, 92, 0.3);
        border-radius: 8px;
        padding: 20px;
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.8);
    `;
    
    popup.innerHTML = `
        <h3 style="margin: 0 0 15px 0; color: #cba35c;">${title}</h3>
        <div style="color: #e0d0c0;">${content}</div>
        <button style="
            margin-top: 15px;
            padding: 8px 16px;
            background: #cd7f32;
            color: #e0d0c0;
            border: 1px solid rgba(203, 163, 92, 0.5);
            border-radius: 4px;
            cursor: pointer;
        ">✓</button>
    `;
    
    // Add close functionality
    popup.querySelector('button').addEventListener('click', () => {
        container.removeChild(popup);
        if (container.children.length === 0) {
            container.style.display = 'none';
        }
    });
    
    // Close on background click
    container.addEventListener('click', (e) => {
        if (e.target === container) {
            container.removeChild(popup);
            if (container.children.length === 0) {
                container.style.display = 'none';
            }
        }
    });
    
    container.style.display = 'flex';
    container.appendChild(popup);
    
    return popup;
}

export function showCustomAlert(msg) {
    let container = document.getElementById('uie-custom-dialog-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'uie-custom-dialog-container';
        container.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.7);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        `;
        document.body.appendChild(container);
    }
    container.style.display = 'flex';

    const modal = document.createElement('div');
    modal.style.cssText = `
        width: min(420px, 92vw);
        background: rgba(15, 10, 8, 0.98);
        border: 2px solid rgba(203, 163, 92, 0.55);
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 20px rgba(203, 163, 92, 0.15);
        color: #f6e7c8;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        text-align: center;
        transform: scale(0.9);
        opacity: 0;
        transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    `;

    modal.innerHTML = `
        <div style="font-size: 32px; color: #cba35c; margin-bottom: 16px;"><i class="fas fa-circle-info"></i></div>
        <div style="font-size: 14px; line-height: 1.6; margin-bottom: 24px; word-break: break-word; color: #e5d5c0;">${escapeHtml(msg)}</div>
        <button class="uie-btn-checkmark" style="
            width: 56px;
            height: 56px;
            border-radius: 50%;
            border: 2px solid rgba(203, 163, 92, 0.6);
            background: rgba(203, 163, 92, 0.12);
            color: #cba35c;
            font-size: 20px;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            outline: none;
        "><i class="fas fa-check"></i></button>
    `;

    container.appendChild(modal);

    setTimeout(() => {
        modal.style.transform = 'scale(1)';
        modal.style.opacity = '1';
    }, 10);

    const btn = modal.querySelector('button');
    btn.focus();
    
    btn.onmouseenter = () => {
        btn.style.background = 'rgba(203, 163, 92, 0.25)';
        btn.style.borderColor = '#cba35c';
        btn.style.boxShadow = '0 0 12px rgba(203, 163, 92, 0.4)';
    };
    btn.onmouseleave = () => {
        btn.style.background = 'rgba(203, 163, 92, 0.12)';
        btn.style.borderColor = 'rgba(203, 163, 92, 0.6)';
        btn.style.boxShadow = 'none';
    };

    const close = () => {
        modal.style.transform = 'scale(0.9)';
        modal.style.opacity = '0';
        setTimeout(() => {
            if (modal.parentNode === container) {
                container.removeChild(modal);
            }
            if (container.children.length === 0) {
                container.style.display = 'none';
            }
        }, 250);
    };

    btn.onclick = close;
}

export function customConfirm(msg) {
    return new Promise((resolve) => {
        let container = document.getElementById('uie-custom-dialog-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'uie-custom-dialog-container';
            container.style.cssText = `
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.7);
                z-index: 2147483647;
                display: flex;
                align-items: center;
                justify-content: center;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
            `;
            document.body.appendChild(container);
        }
        container.style.display = 'flex';

        const modal = document.createElement('div');
        modal.style.cssText = `
            width: min(440px, 92vw);
            background: rgba(10, 14, 22, 0.98);
            border: 2px solid rgba(45, 212, 191, 0.4);
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 20px rgba(45, 212, 191, 0.15);
            color: #e2e8f0;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            text-align: center;
            transform: scale(0.9);
            opacity: 0;
            transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        `;

        modal.innerHTML = `
            <div style="font-size: 32px; color: #2dd4bf; margin-bottom: 16px;"><i class="fas fa-question-circle"></i></div>
            <div style="font-size: 14px; line-height: 1.6; margin-bottom: 24px; word-break: break-word; color: #cbd5e1;">${escapeHtml(msg)}</div>
            <div style="display: flex; justify-content: center; gap: 16px;">
                <button class="uie-btn-cancel" style="
                    width: 56px;
                    height: 56px;
                    border-radius: 50%;
                    border: 2px solid rgba(239, 68, 68, 0.6);
                    background: rgba(239, 68, 68, 0.12);
                    color: #ef4444;
                    font-size: 20px;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    outline: none;
                "><i class="fas fa-times"></i></button>
                <button class="uie-btn-checkmark" style="
                    width: 56px;
                    height: 56px;
                    border-radius: 50%;
                    border: 2px solid rgba(45, 212, 191, 0.6);
                    background: rgba(45, 212, 191, 0.12);
                    color: #2dd4bf;
                    font-size: 20px;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    outline: none;
                "><i class="fas fa-check"></i></button>
            </div>
        `;

        container.appendChild(modal);

        setTimeout(() => {
            modal.style.transform = 'scale(1)';
            modal.style.opacity = '1';
        }, 10);

        const btnCancel = modal.querySelector('.uie-btn-cancel');
        const btnConfirm = modal.querySelector('.uie-btn-checkmark');
        
        btnConfirm.focus();

        btnCancel.onmouseenter = () => {
            btnCancel.style.background = 'rgba(239, 68, 68, 0.25)';
            btnCancel.style.borderColor = '#ef4444';
            btnCancel.style.boxShadow = '0 0 12px rgba(239, 68, 68, 0.4)';
        };
        btnCancel.onmouseleave = () => {
            btnCancel.style.background = 'rgba(239, 68, 68, 0.12)';
            btnCancel.style.borderColor = 'rgba(239, 68, 68, 0.6)';
            btnCancel.style.boxShadow = 'none';
        };

        btnConfirm.onmouseenter = () => {
            btnConfirm.style.background = 'rgba(45, 212, 191, 0.25)';
            btnConfirm.style.borderColor = '#2dd4bf';
            btnConfirm.style.boxShadow = '0 0 12px rgba(45, 212, 191, 0.4)';
        };
        btnConfirm.onmouseleave = () => {
            btnConfirm.style.background = 'rgba(45, 212, 191, 0.12)';
            btnConfirm.style.borderColor = 'rgba(45, 212, 191, 0.6)';
            btnConfirm.style.boxShadow = 'none';
        };

        const close = (val) => {
            modal.style.transform = 'scale(0.9)';
            modal.style.opacity = '0';
            setTimeout(() => {
                if (modal.parentNode === container) {
                    container.removeChild(modal);
                }
                if (container.children.length === 0) {
                    container.style.display = 'none';
                }
                resolve(val);
            }, 250);
        };

        btnCancel.onclick = () => close(false);
        btnConfirm.onclick = () => close(true);
    });
}

export function customPrompt(msg, defaultValue = "") {
    return new Promise((resolve) => {
        let container = document.getElementById('uie-custom-dialog-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'uie-custom-dialog-container';
            container.style.cssText = `
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.7);
                z-index: 2147483647;
                display: flex;
                align-items: center;
                justify-content: center;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
            `;
            document.body.appendChild(container);
        }
        container.style.display = 'flex';

        const modal = document.createElement('div');
        modal.style.cssText = `
            width: min(460px, 92vw);
            background: rgba(10, 14, 22, 0.98);
            border: 2px solid rgba(45, 212, 191, 0.4);
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 20px rgba(45, 212, 191, 0.15);
            color: #e2e8f0;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            text-align: center;
            transform: scale(0.9);
            opacity: 0;
            transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        `;

        modal.innerHTML = `
            <div style="font-size: 32px; color: #2dd4bf; margin-bottom: 16px;"><i class="fas fa-edit"></i></div>
            <div style="font-size: 14px; line-height: 1.6; margin-bottom: 16px; word-break: break-word; color: #cbd5e1; text-align: left;">${escapeHtml(msg)}</div>
            <input type="text" class="uie-prompt-input" value="${escapeHtml(defaultValue)}" style="
                width: 100%;
                box-sizing: border-box;
                padding: 10px 14px;
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.16);
                background: rgba(255,255,255,0.06);
                color: #fff;
                font-size: 14px;
                margin-bottom: 24px;
                outline: none;
                transition: border-color 0.2s;
            ">
            <div style="display: flex; justify-content: center; gap: 16px;">
                <button class="uie-btn-cancel" style="
                    width: 56px;
                    height: 56px;
                    border-radius: 50%;
                    border: 2px solid rgba(239, 68, 68, 0.6);
                    background: rgba(239, 68, 68, 0.12);
                    color: #ef4444;
                    font-size: 20px;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    outline: none;
                "><i class="fas fa-times"></i></button>
                <button class="uie-btn-checkmark" style="
                    width: 56px;
                    height: 56px;
                    border-radius: 50%;
                    border: 2px solid rgba(45, 212, 191, 0.6);
                    background: rgba(45, 212, 191, 0.12);
                    color: #2dd4bf;
                    font-size: 20px;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    outline: none;
                "><i class="fas fa-check"></i></button>
            </div>
        `;

        container.appendChild(modal);

        setTimeout(() => {
            modal.style.transform = 'scale(1)';
            modal.style.opacity = '1';
        }, 10);

        const input = modal.querySelector('.uie-prompt-input');
        const btnCancel = modal.querySelector('.uie-btn-cancel');
        const btnConfirm = modal.querySelector('.uie-btn-checkmark');

        input.focus();
        input.select();

        input.onfocus = () => { input.style.borderColor = '#2dd4bf'; };
        input.onblur = () => { input.style.borderColor = 'rgba(255,255,255,0.16)'; };

        btnCancel.onmouseenter = () => {
            btnCancel.style.background = 'rgba(239, 68, 68, 0.25)';
            btnCancel.style.borderColor = '#ef4444';
            btnCancel.style.boxShadow = '0 0 12px rgba(239, 68, 68, 0.4)';
        };
        btnCancel.onmouseleave = () => {
            btnCancel.style.background = 'rgba(239, 68, 68, 0.12)';
            btnCancel.style.borderColor = 'rgba(239, 68, 68, 0.6)';
            btnCancel.style.boxShadow = 'none';
        };

        btnConfirm.onmouseenter = () => {
            btnConfirm.style.background = 'rgba(45, 212, 191, 0.25)';
            btnConfirm.style.borderColor = '#2dd4bf';
            btnConfirm.style.boxShadow = '0 0 12px rgba(45, 212, 191, 0.4)';
        };
        btnConfirm.onmouseleave = () => {
            btnConfirm.style.background = 'rgba(45, 212, 191, 0.12)';
            btnConfirm.style.borderColor = 'rgba(45, 212, 191, 0.6)';
            btnConfirm.style.boxShadow = 'none';
        };

        const close = (val) => {
            modal.style.transform = 'scale(0.9)';
            modal.style.opacity = '0';
            setTimeout(() => {
                if (modal.parentNode === container) {
                    container.removeChild(modal);
                }
                if (container.children.length === 0) {
                    container.style.display = 'none';
                }
                resolve(val);
            }, 250);
        };

        btnCancel.onclick = () => close(null);
        btnConfirm.onclick = () => close(input.value);

        input.onkeydown = (e) => {
            if (e.key === "Enter") {
                btnConfirm.click();
            } else if (e.key === "Escape") {
                btnCancel.click();
            }
        };
    });
}

// Override alert globally on load
if (typeof window !== "undefined") {
    window.alert = showCustomAlert;
    window.customConfirm = customConfirm;
    window.customPrompt = customPrompt;
}
