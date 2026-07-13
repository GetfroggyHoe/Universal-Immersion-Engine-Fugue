/**
 * Event handlers for new UI buttons (settings, music, edit room, navigation directions)
 */

export function initUIButtons() {
    // Settings button (opens RPG/config settings)
    document.getElementById("q-settings")?.addEventListener("click", () => {
        document.getElementById("btn-config")?.click();
    });

    // Music button
    document.getElementById("q-music")?.addEventListener("click", () => {
        const musicModal = document.getElementById("music-modal");
        if (musicModal) {
            musicModal.classList.add("active");
            musicModal.style.display = "flex";
        } else {
            document.getElementById("btn-time-weather")?.click();
        }
    });

    // Hot Spots editor button
    document.getElementById("q-edit-room")?.addEventListener("click", () => {
        document.getElementById("btn-edit-room")?.click();
    });

    // N/S/E/W direction buttons
    const dirButtons = [
        { id: "nav-north", dir: "north" },
        { id: "nav-south", dir: "south" },
        { id: "nav-east", dir: "east"  },
        { id: "nav-west", dir: "west"  },
    ];

    dirButtons.forEach(({ id, dir }) => {
        document.getElementById(id)?.addEventListener("click", async () => {
            try {
                const nav = await import("./navigation.js");
                if (typeof nav.moveDirectionSilent === "function") {
                    nav.moveDirectionSilent(dir);
                }
            } catch (e) {
                console.warn(`[Nav] Failed to move ${dir}:`, e);
            }
        });
    });
}
