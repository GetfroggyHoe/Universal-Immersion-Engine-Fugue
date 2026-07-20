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
}
