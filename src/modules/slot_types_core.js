/**
 * Slot Types Core Registry
 * - Categories and their groups
 * - Keywords per category (broad)
 * Keep this file "structural": category/group names + broad keywords.
 * Put huge alias lists in slot_types_synonyms.js
 */

export const SLOT_TYPES_CORE = {
  // 0) Equipment classifications (for items grid classification, not paper-doll slots)
  EQUIPMENT_CLASS: {
    keywords: [
      "weapon","armor","blade","sword","dagger","knife","mace","hammer","polearm","spear","bow","crossbow",
      "wand","staff","orb","rod","grimoire","shield","buckler","plate","leather","chain","robe","cloak"
    ],
    groups: {
      "Blade (Short)": [],
      "Blade (Long)": [],
      "Blunt": [],
      "Polearm": [],
      "Ranged (Mech)": [],
      "Magic Focus": [],
      "Shields": [],
      "Armor (Light)": [],
      "Armor (Medium)": [],
      "Armor (Heavy)": [],
    }
  },

  // 1) Alchemy
  ALCHEMY: {
    keywords: [
      "alchemy","potion","elixir","poison","reagent","solvent","catalyst","extract","essence","tincture",
      "distillate","mutagen","serum","virus","dna","ichor","venom","slime","acid","gas","vial","flask",
      "alembic","retort","mortar","pestle","crucible","brimstone","quicksilver","sulfur","saltpetre",
      "nightshade","aconite","belladonna","panacea","philtre","draught","decoction","infusion",
      "concoction","base","transmutation","homunculus","mercury","vitriol","philosopher","hermetic",
      "distil","fermenter","catalyzer","solubilizer","beaker","distilled water","aqua regia","elixir of life",
      "alchemy recipe","potion recipe","poison recipe","reagent formula","distillation formula"
    ],
    groups: {
      "Base": [],
      "Solid Reagents": [],
      "Mineral Reagents": [],
      "Animal Parts": [],
      "Refined States": [],
      "Containers/Catalysts": [],
      "Mutagens": [],
      "Combustibles": [],
      "Celestial": [],
      "Preservatives": [],
      "Poisons (Contact)": [],
      "Poisons (Ingested)": [],
      "Solvents (Acid)": [],
      "Gases": [],
      "Biological Fluids": [],
      "Philosophical": [],
      "Alchemical Tools": [],
      "Hermetic Catalysts": [],
      "Exotic Transmuters": [],
      "Homunculi Reagents": [],
      "Alchemy Recipes": [],
      "Potion Formulae": []
    }
  },

  // 2) Enchantment
  ENCHANTMENT: {
    keywords: [
      "enchant","enchantment","rune","sigil","glyph","ward","seal","socket","runeword","gem","jewel",
      "arcane dust","holy dust","shadow dust","void","astral","phylactery","soul gem","totem","talisman",
      "hex","curse","ritual","summon","aura","metaphysical","fate","karma",
      "ether","mana","leylines","focus","attunement","prismatic","shard","draconic","abyssal",
      "resonance","imbue","amulet","relic","obelisk","monolith","tomb","shrine","crystal grid",
      "infusion","geomancy","divine spark","celestial stone","void shard",
      "enchantment recipe","enchanting recipe","rune recipe","imbue formula"
    ],
    groups: {
      "Runes": [],
      "Gems (Socketables)": [],
      "Magical Dusts": [],
      "Components": [],
      "Catalysts": [],
      "Binding Agents": [],
      "Voodoo/Hex": [],
      "Ritual": [],
      "Spirit": [],
      "Fortune": [],
      "Warding": [],
      "Curses": [],
      "Summoning": [],
      "Auras": [],
      "Sockets (Runewords)": [],
      "Metaphysical": [],
      "Leyline Focuses": [],
      "Prismatic Gems": [],
      "Astral Essences": [],
      "Celestial Shards": [],
      "Enchantment Recipes": [],
      "Runic Formulae": []
    }
  },

  // 3) Crafting
  CRAFTING: {
    keywords: [
      "craft","crafting","smith","blacksmith","carpentry","engineering",
      "ore","ingot","plate","sheet","rod","wire","scrap","slag",
      "log","plank","beam","veneer","plywood",
      "nail","screw","bolt","nut","rivet","hinge","buckle","clasp",
      "flux","varnish","glue","resin","grease",
      "gear","spring","chain","ceramic","porcelain","brick","tile","pipe",
      "forge","anvil","smelter","bellows","tongs","crucible","alloy",
      "mithril","adamantite","orichalcum","obsidian","bronze","steel","iron","copper","tin","silver","gold","platinum","titanium","cobalt",
      "dwarven steel","elven timber","rivets","welding","sawdust","lathe","chisel",
      "forge recipe","smithing recipe","crafting recipe","weapon recipe","armor recipe"
    ],
    groups: {
      "Metals": [],
      "Woods": [],
      "Textiles": [],
      "Intermediate Parts": [],
      "Refining Agents": [],
      "Specialty": [],
      "Synthetics": [],
      "Electronics": [],
      "Mechanisms": [],
      "Adhesives": [],
      "Tools (Consumable)": [],
      "Liquids (Industrial)": [],
      "Glass/Optics": [],
      "Paper/Packaging": [],
      "Precious Materials": [],
      "Scrap (Tech)": [],
      "Alloys (Exotic)": [],
      "Dwarven Smithing": [],
      "Elven Joinery": [],
      "Forge Fuel": [],
      "Forge Recipes": [],
      "Weapon Blueprints": [],
      "Armor Blueprints": []
    }
  },

  // 4) Cooking
  COOKING: {
    keywords: [
      "cook","cooking","ingredient","meal","provision","spice","herb","broth","sauce","vinegar","honey",
      "meat","fish","poultry","fruit","vegetable","dairy","egg","grain","flour","bread","pastry",
      "ferment","yeast","culture","drink","coffee","tea","cocoa","juice","smoothie",
      "beer","ale","wine","whiskey","vodka","rum","gin","sake","mead",
      "dessert","cake","pie","cookie","ice cream","jam","pickle","kimchi",
      "feast","banquet","ration","marinate","braise","stew","sear","grill","bake","roast","smoke","salt","cure",
      "seasoning","flavoring","royal jelly","truffle butter","nectar","ambrosia","smoked meat","herbal infusion"
    ],
    groups: {
      "Meats": [],
      "Vegetables": [],
      "Fruits": [],
      "Dairy/Eggs": [],
      "Grains/Baking": [],
      "Seasoning/Misc": [],
      "Fermentation": [],
      "Drinks (Hot)": [],
      "Drinks (Cold)": [],
      "Alcohol": [],
      "Dishes (Main)": [],
      "Dishes (Side)": [],
      "Desserts": [],
      "Exotic Meat": [],
      "Preserves": [],
      "Condiments": [],
      "Feast Platters": [],
      "Ambrosial Sweets": [],
      "Herbal Teas": [],
      "Rations (Travel)": []
    }
  },

  // 5) Misc
  MISC: {
    keywords: [
      "currency","coin","token","chip","credit","scrip","valuable","antique","heirloom","bullion","bond","deed",
      "junk","trash","debris","rag","broken","sludge",
      "gift","perfume","toy","doll","ribbon","comb","mirror",
      "soap","bandage","salve","torch","flint","tinder","tobacco","pipe",
      "sack","crate","barrel","box","chest","pouch","envelope","packet","jar","tin",
      "game","dice","cards","hygiene","office","mail",
      "bauble","curio","trinket","keepsake","token","charcoal","memento","keepsake chest","parlor games","novelty"
    ],
    groups: {
      "Currency": [],
      "Valuables": [],
      "Junk": [],
      "Gifts": [],
      "Consumables (Non-Food)": [],
      "Containers": [],
      "Games": [],
      "Toys": [],
      "Musical": [],
      "Hygiene": [],
      "Clothing (Cosmetic)": [],
      "Smoking": [],
      "Trash (Organic)": [],
      "Trash (Inorganic)": [],
      "Office": [],
      "Mail": [],
      "Curios & Antiques": [],
      "Keepsakes": [],
      "Arcane Baubles": []
    }
  },

  // 6) Quest / Key Items
  QUEST: {
    keywords: [
      "quest","key item","key","keycard","passcode","signet","activation",
      "letter","note","diary","journal","contract","treaty","bounty","manifesto","map",
      "evidence","clue","photo","recording","blueprint","schematic","cipher","dossier","transcript",
      "trophy","badge","medal","insignia","rank","title","certificate","award",
      "artifact","relic","macguffin","parcel","shipment","cargo","beacon","signal",
      "identification","passport","permit","form","voucher","ticket","contraband",
      "ancient decree","royal seal","cursed object","unsealed scroll","tomb key","elder signet","guild charter"
    ],
    groups: {
      "Keys": [],
      "Documents": [],
      "Intel": [],
      "Magical Keys": [],
      "Trophies": [],
      "Unique": [],
      "Identification": [],
      "Crime": [],
      "Body Parts (Monster)": [],
      "Bureaucracy": [],
      "Tickets": [],
      "Keys (Specific)": [],
      "Lost Items": [],
      "Messages": [],
      "Tokens": [],
      "Packages": [],
      "Relics of Power": [],
      "Elder Decrees": [],
      "Cursed Tokens": []
    }
  },

  // 7) Farming
  FARMING: {
    keywords: [
      "seed","sapling","fertilizer","compost","mulch","lime","bonemeal","sprinkler","watering can","hose",
      "scarecrow","fence","gate","trellis","planter","greenhouse","trowel","rake","pitchfork",
      "hydroponic","ph tester","ec meter","beekeeping","hive","propolis","orchard",
      "magical spore","luminous seed","enriched soil","growth elixir","sunlight flask","druid soil"
    ],
    groups: {
      "Seeds (Seasonal)": [],
      "Saplings/Trees": [],
      "Enhancers": [],
      "Irrigation/Tools": [],
      "Infrastructure": [],
      "Harvest Tools": [],
      "Mushrooms": [],
      "Hydroponics": [],
      "Beekeeping": [],
      "Automation": [],
      "Exotic Crops": [],
      "Orchard": [],
      "Flowers": [],
      "Fencing": [],
      "Greenhouse": [],
      "Compost": [],
      "Druidic Soils": [],
      "Growth Elixirs": [],
      "Bioluminescent Fungi": []
    }
  },

  // 8) Husbandry
  HUSBANDRY: {
    keywords: [
      "hay","fodder","feed","treat","groom","brush","hoof","shear","clipper","shampoo",
      "saddle","bridle","reins","stirrups","halter","tack","harness","collar","leash",
      "incubator","milker","trough","stable","barn","coop","silo",
      "vet","syringe","ointment","cast","splint","genetic","dna","fertilized egg",
      "mount","taming","trap","tranquilizer",
      "mythical feed","pegasus bridle","gryphon saddle","beast whistle","taming snare","monster bait","dragon egg"
    ],
    groups: {
      "Fodder": [],
      "Treats/Bonding": [],
      "Grooming": [],
      "Tack (Mounts)": [],
      "Equipment": [],
      "Housing/Care": [],
      "Fantasy Pets": [],
      "Genetics": [],
      "Veterinary": [],
      "Toys": [],
      "Housing (Specific)": [],
      "Grooming (Advanced)": [],
      "Feed (Premium)": [],
      "Mount Gear": [],
      "Products": [],
      "Wild Taming": [],
      "Mythical Saddles": [],
      "Egg Incubations": [],
      "Beast Calls": []
    }
  },

  // 9) Fishing
  FISHING: {
    keywords: [
      "rod","bait","lure","tackle","hook","sinker","bobber","line","trap","crab pot",
      "harpoon","net","license","angler","legendary fish","ice fishing","lava fishing","void fishing",
      "boat","anchor","oar","paddle","sail","sonar","radar",
      "lava line","void bobber","mithril hook","kraken harpoon","siren bait","glow lure"
    ],
    groups: {
      "Rods": [],
      "Baits (Consumable)": [],
      "Lures (Durable)": [],
      "Tackle": [],
      "Traps": [],
      "Utility": [],
      "Lava Fishing": [],
      "Void Fishing": [],
      "Ice Fishing": [],
      "Boat Gear": [],
      "Legendary Fish": [],
      "Shellfish": [],
      "Crustaceans": [],
      "Deep Sea": [],
      "Trophies": [],
      "Processing": [],
      "Exotic Lines": [],
      "Eldritch Hooks": [],
      "Siren Lures": []
    }
  },

  // 10) Housing & Decor
  HOUSING: {
    keywords: [
      "chair","sofa","table","desk","counter","altar","workbench","bed","hammock","sleeping bag",
      "wardrobe","dresser","cabinet","shelf","bookcase","safe",
      "lamp","chandelier","sconce","candle","lantern","fireplace","brazier",
      "rug","tapestry","painting","poster","statue","vase","mirror","clock",
      "toilet","sink","bathtub","shower","kitchen","fridge","stove","oven","microwave",
      "arcane altar","gargoyle sconce","runed chest","alchemical table","scrying stand","summoning circle"
    ],
    groups: {
      "Seating": [],
      "Surfaces": [],
      "Sleeping": [],
      "Storage": [],
      "Lighting": [],
      "Decor": [],
      "Electronics (Entertainment)": [],
      "Electronics (Office)": [],
      "Bathroom": [],
      "Kitchen (Appliances)": [],
      "Flooring (Types)": [],
      "Walls (Paper)": [],
      "Windows": [],
      "Fireplace": [],
      "Outdoor Decor": [],
      "Structural": [],
      "Ritual Altars": [],
      "Magical Storage": [],
      "Artisan Workbenches": []
    }
  },

  // 11) Knowledge & Skill
  KNOWLEDGE: {
    keywords: [
      "recipe","cookbook","blueprint","pattern","schematic","manual","treatise","guide","textbook","scroll",
      "map","atlas","chart","bestiary","chronicle","myth","legend","law",
      "usb","sd card","hard drive","ssd","floppy","cd","dvd","tape",
      "data crystal","memory shard","echo stone","thought gem","cipher","codebook","rosetta",
      "ancient tome","elder scroll","stellar atlas","spellsheet","runic codex","grimoire page"
    ],
    groups: {
      "Recipes (Culinary)": [],
      "Schematics (Crafting)": [],
      "Skill Books": [],
      "Maps": [],
      "Bestiary": [],
      "History/Culture": [],
      "Digital Media": [],
      "Crystal Storage": [],
      "Arcane Records": [],
      "Maps (Specific)": [],
      "Books (Genres)": [],
      "Notes": [],
      "Languages": [],
      "Research": [],
      "Teaching": [],
      "Secrets": [],
      "Tombs & Grimoires": [],
      "Runic Inscriptions": [],
      "Celestial Records": []
    }
  },

  // 13) Entomology
  ENTOMOLOGY: {
    keywords: [
      "butterfly","moth","beetle","cicada","mantis","dragonfly","bee","wasp","hornet","roach","ant","termite",
      "spider","scorpion","tick","mite","slug","snail","worm","leech",
      "net","specimen","jar","pin","mount","magnifying","field guide","pheromone",
      "faerie moth","glow cicada","viper wasp","shadow beetle","bioluminescent insect"
    ],
    groups: {
      "Butterflies/Moths": [],
      "Beetles": [],
      "Crawlers": [],
      "Hoppers/Flyers": [],
      "Aquatic/Swamp": [],
      "Collection Tools": [],
      "Arachnids": [],
      "Hive Products": [],
      "Worms/Slugs": [],
      "Exotic Bugs": [],
      "Pests": [],
      "Catching (Baits)": [],
      "Display": [],
      "Breeding": [],
      "Tools": [],
      "Lore": [],
      "Faerie Insects": [],
      "Cursed Crawlers": [],
      "Hive Specimens": []
    }
  },

  // 14) Archaeology & Geology
  ARCHAEOLOGY: {
    keywords: [
      "geode","fossil","artifact","relic","excavate","dig","museum","node","crystal cluster",
      "pickaxe","brush","chisel","sieve","shovel","pan","drill","headlamp",
      "restoration","survey","metal detector","lidar","radar",
      "runic tablet","petrified egg","dragon bone","ancient obelisk","ley scanner"
    ],
    groups: {
      "Geodes/Nodes": [],
      "Fossils (Parts)": [],
      "Fossils (Complete)": [],
      "Artifacts (Household)": [],
      "Artifacts (Ritual)": [],
      "Tools": [],
      "Cleaning Tools": [],
      "Survey": [],
      "Excavation": [],
      "Storage": [],
      "Artifacts (Stone)": [],
      "Artifacts (Metal)": [],
      "Artifacts (Organic)": [],
      "Artifacts (Ceramic)": [],
      "Restoration": [],
      "Era": [],
      "Dragon Relics": [],
      "Runic Monuments": [],
      "Geological Surveys": []
    }
  },

  // 15) Survival & Exploration
  SURVIVAL: {
    keywords: [
      "tent","bedroll","tarp","hammock","blanket","torch","tinder","firestarter","flint","steel",
      "canteen","waterskin","filter","purifier","ration","mre","jerky","trail mix",
      "rope","grappling","piton","carabiner","harness","crampons","ice axe",
      "compass","sextant","spyglass","binoculars","beacon","flare","whistle",
      "first aid","bandage","tourniquet","antidote","splint","stitch kit",
      "elven tent","frost bedroll","aether canteen","grappling rune","phoenix tinder","thermal cloak"
    ],
    groups: {
      "Shelter": [],
      "Fire/Heat": [],
      "Hydration/Food": [],
      "Climbing/Traversal": [],
      "Navigation": [],
      "Field Medicine": [],
      "Hunting": [],
      "Signaling": [],
      "Weather": [],
      "Navigation (Celestial)": [],
      "Water": [],
      "Fire": [],
      "Shelter (Natural)": [],
      "First Aid": [],
      "Tools": [],
      "Food (Wild)": [],
      "Magical Shelters": [],
      "Warmth Runes": [],
      "Emergency Medicine": []
    }
  },

  // 16) Construction & Architecture
  CONSTRUCTION: {
    keywords: [
      "wall","floor","roof","door","gate","window","stair","ladder","pillar","beam","arch","support",
      "fence","turret","spikes","moat","bridge","signpost","mailbox","flagpole",
      "generator","battery","transformer","fuse","switch","outlet","sensor","relay","logic gate",
      "bulldozer","excavator","crane","forklift","dumptruck","mixer",
      "pipe","valve","coupling","pump","concrete","drywall","insulation","asphalt",
      "forcefield pylon","obsidian brick","mana pipe","runic barrier","gargoyle guard"
    ],
    groups: {
      "Walls": [],
      "Floors": [],
      "Roofing": [],
      "Access": [],
      "Vertical": [],
      "Utility/Defense": [],
      "Power": [],
      "Logic": [],
      "Heavy Machinery": [],
      "Pipes": [],
      "Materials (Raw)": [],
      "Materials (Refined)": [],
      "Fasteners": [],
      "Finishing": [],
      "Safety": [],
      "Demolition": [],
      "Energy Barriers": [],
      "Reinforced Bricks": [],
      "Gargoyles & Sentry Wards": []
    }
  },

  // 17) Merchant & Trade Goods
  MERCHANT: {
    keywords: [
      "crate","barrel","sack","bundle","pallet","invoice","ledger","bill of lading","permit","license",
      "luxury","caviar","saffron","vanilla","tea","coffee","wine","vintage",
      "bullion","gold","platinum","stock","bond","share","loan","debt","insurance",
      "black market","contraband","smuggled","forgery","service","repair","upgrade","identify",
      "royal charter","guild ledger","smuggled spice","exotic bullion","black market pass"
    ],
    groups: {
      "Bulk Crates": [],
      "Textile Goods": [],
      "Luxury Food": [],
      "Art/Jewelry": [],
      "Industry": [],
      "Documents": [],
      "Black Market": [],
      "Services": [],
      "Financial": [],
      "Real Estate": [],
      "Trade Goods (Raw)": [],
      "Trade Goods (Processed)": [],
      "Currencies": [],
      "Packaging": [],
      "Shop Gear": [],
      "Reputation": [],
      "Guild Contracts": [],
      "Illicit Smuggling": [],
      "Noble Deeds": []
    }
  },

  // 18) Foraging & Botany
  FORAGING: {
    keywords: [
      "moss","lichen","fungus","mushroom","wildflower","berry","root","tuber","bark","sap","resin",
      "pinecone","acorn","thorn","vine","seaweed","kelp","driftwood",
      "forage","gather","sickle","clippers","basket","snare","truffle",
      "glowing moss","cave mushroom","medicinal herb","swamp root"
    ],
    groups: {
      "Wild Edibles": [],
      "Fungi": [],
      "Medicinal Herbs": [],
      "Poisonous Flora": [],
      "Aquatic Plants": [],
      "Woods/Barks": [],
      "Saps/Resins": [],
      "Foraging Tools": []
    }
  },

  // 19) Tailoring & Fashion
  TAILORING: {
    keywords: [
      "thread","spool","needle","thimble","scissors","shears","loom","spinning wheel",
      "fabric","bolt","silk","cotton","wool","leather","pelt","hide","scale",
      "dye","pigment","bleach","mordant","pattern","mannequin",
      "clothing","hat","glove","boot","belt","cloak","mask","cosmetic",
      "alchemical thread","mana thread","infused fiber","spirit stitch","transmutation bolt",
      "vial holder","solvent strap","reagent pouch","alchemical binding","anima strand",
      "essence weave","hermetic cloth","transmuted leather","stitching needle"
    ],
    groups: {
      "Raw Fibers": [],
      "Spun Threads": [],
      "Woven Fabrics": [],
      "Leathers/Hides": [],
      "Dyes/Pigments": [],
      "Tailoring Tools": [],
      "Patterns/Blueprints": [],
      "Cosmetic Wearables": [],
      "Accessories": [],
      "Alchemical Stitching": [],
      "Infused Binders": [],
      "Reagent Carriers": []
    }
  },

  // 20) Occult & Necromancy
  OCCULT: {
    keywords: [
      "bone","skull","blood","ash","ectoplasm","soul","spirit","graveyard dirt","tombstone",
      "ouija","tarot","pendulum","scrying","crystal ball","incense","chalk","salt",
      "sacrificial","effigy","voodoo","talisman","fetish","grimoire","pact",
      "demonic","necromancy","wraith","phantom","ichor","cursed doll","black candle"
    ],
    groups: {
      "Remains (Bones/Ash)": [],
      "Fluids (Blood/Ichor)": [],
      "Spirits/Souls": [],
      "Divination Tools": [],
      "Ritual Components": [],
      "Cursed Objects": [],
      "Effigies/Totems": [],
      "Dark Pacts": []
    }
  },

  // 21) Bardic & Performance
  BARDIC: {
    keywords: [
      "lute","lyre","flute","drum","horn","harp","fiddle","guitar","string","rosin","tuning fork",
      "sheet music","songbook","lyric","poem","script","play",
      "mask","makeup","prop","juggling","fire breathing","stage",
      "bardic buff","orchestration","theater prop","sonnet","ballad","troubadour"
    ],
    groups: {
      "String Instruments": [],
      "Wind Instruments": [],
      "Percussion": [],
      "Instrument Parts": [],
      "Sheet Music": [],
      "Theatrical Props": [],
      "Performance Gear": [],
      "Makeup/Disguise": []
    }
  },

  UNCATEGORIZED: { keywords: [], groups: {} },
};
