import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";

const DEFAULT_GUIDE = {
    id: "guide",
    title: "User Guide",
    type: "text",
    content: "<h1>Universal Immersion Engine</h1><p>Welcome to V25 Sovereign. Use the Phone for apps, Inventory for gear, and Social for relationships.</p><h3>Apps</h3><p>Use the Sparkle button to generate new items using AI.</p>"
};

const LIB_DOC_CATEGORIES = {
    book: "real bound book with cover, pages, chapter heading",
    tome: "heavy ancient tome with clasps, aged paper, marginalia",
    grimoire: "magical grimoire with sigils, spell sections, ritual notes",
    textbook: "school textbook with unit label, key terms, lesson blocks, table",
    note: "loose handwritten note with tape or lined paper",
    scroll: "rolled scroll with rods and proclamation styling"
};

function inferLibraryDocType(raw) {
    const s = String(raw || "").toLowerCase();
    if (/\bgrimoire|spellbook|ritual|arcane\b/.test(s)) return "grimoire";
    if (/\btome|codex|ancient\b/.test(s)) return "tome";
    if (/\btextbook|school|lesson|unit|course\b/.test(s)) return "textbook";
    if (/\bnote|letter|memo|loose page\b/.test(s)) return "note";
    if (/\bscroll|decree|proclamation\b/.test(s)) return "scroll";
    return "book";
}

function fallbackLibraryDoc(title, type) {
    const safe = String(title || "Untitled").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<style>.lib-generated-doc{max-width:720px;margin:auto;padding:24px;color:#2f1d12;font-family:Georgia,serif;line-height:1.65}.lib-generated-doc.book{background:#f7ecd0;border:10px solid #6b3f22}.lib-generated-doc.tome{background:#d8c09a;border:14px ridge #4b2d18}.lib-generated-doc.grimoire{background:#211829;color:#f2e5ff;border:12px double #9a6cff}.lib-generated-doc.textbook{background:#eef5ff;border:8px solid #2d5d8a;font-family:Arial,sans-serif}.lib-generated-doc.note{max-width:520px;background:#fff7b8;border:1px solid #d8bf62;box-shadow:0 10px 25px rgba(0,0,0,.25);transform:rotate(-1deg)}.lib-generated-doc.scroll{background:#ead2a0;border-left:18px solid #8a5a2b;border-right:18px solid #8a5a2b}</style><article class="lib-generated-doc ${type}"><h1>${safe}</h1><p>Fallback ${type} template. The AI writer was unavailable, so this document uses the strict preset category shell.</p><p>Request: ${safe}</p></article>`;
}

export function initLibrary() {
    renderShelf();
    const doc = $(document);

    doc.off("click", ".lib-book-item").on("click", ".lib-book-item", function() {
        $(".lib-book-item").css("background", "transparent");
        $(this).css("background", "rgba(0,0,0,0.05)");
        const id = $(this).data("id");
        const s = getSettings();
        const book = (s.library || []).find(b => b.id == id) || DEFAULT_GUIDE;
        $("#uie-lib-reader").html(book.content);
    });

    doc.off("click", "#uie-lib-gen-btn").on("click", "#uie-lib-gen-btn", async () => {
        const title = prompt("Book Title / Topic?");
        if(!title) return;
        const type = inferLibraryDocType(prompt("Type (book / tome / grimoire / textbook / note / scroll)", "book") || title);
        
        if(window.toastr) toastr.info("Writing book...");
        
        const promptText = `Generate a short ${type} about: "${title}". Output raw HTML only, no scripts.
        STRICT TEMPLATE CATEGORY: ${type} (${LIB_DOC_CATEGORIES[type]}).
        The HTML and CSS must make it visually read as that physical category. Do not reuse the same generic parchment style for every category.`;
        
        let res = "";
        try { res = await generateContent(promptText, "Webpage"); } catch (_) { res = ""; }
        
        const s = getSettings();
        if(!s.library) s.library = [DEFAULT_GUIDE];
        s.library.push({ id: Date.now(), title: title, type: type, content: res || fallbackLibraryDoc(title, type) });
        saveSettings();
        renderShelf();
    });
}

function renderShelf() {
    const s = getSettings();
    if(!s.library) s.library = [DEFAULT_GUIDE];
    const shelf = $("#uie-lib-shelf").empty();
    
    const tmpl = document.getElementById("uie-template-lib-book");
    if (!tmpl) return;

    const frag = document.createDocumentFragment();

    s.library.forEach(b => {
        let icon = "fa-book";
        if(b.type === "comic" || b.type === "manga") icon = "fa-book-open";
        
        const clone = tmpl.content.cloneNode(true);
        const item = clone.querySelector(".lib-book-item");
        if (item) item.setAttribute("data-id", b.id);
        
        const iEl = clone.querySelector("i");
        if (iEl) iEl.classList.add(icon);
        
        const titleEl = clone.querySelector(".lib-book-title");
        if (titleEl) titleEl.textContent = b.title;
        
        frag.appendChild(clone);
    });
    shelf.append(frag);
}
