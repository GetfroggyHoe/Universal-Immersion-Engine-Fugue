import fs from 'fs';
import path from 'path';

const baseDir = './assets/Food';

const mapping = {
  "Cooked Perfectly (Meat)/1000213911~2.png": "Cooked Perfectly (Meat)/poultry_brown-orange-yellow_irregular_soft-smooth_cooked_roast-chicken.png",
  "Cooked Perfectly (Meat)/1000213911~3.png": "Cooked Perfectly (Meat)/meat_brown-red-white_flat_soft-wet_cooked_pork-belly.png",
  "Cooked Perfectly (Meat)/1000213911~4.png": "Cooked Perfectly (Meat)/poultry_brown-red_flat-irregular_soft-smooth_cooked_roast-duck.png",
  "Cooked Perfectly (Meat)/1000213911~5.png": "Cooked Perfectly (Meat)/meat_brown-white_round-long-irregular_soft-smooth_cooked_roast-meat-roll.png",
  "Cooked Perfectly (Meat)/1000213911~6.png": "Cooked Perfectly (Meat)/seafood_orange-brown_flat-curved-irregular_soft-wet_cooked_salmon-fillet.png",
  "Cooked Perfectly (Meat)/1000213911~7.png": "Cooked Perfectly (Meat)/poultry_brown-orange-white_long-round-irregular_soft-smooth_cooked_chicken-drumstick.png",
  "Cooked Perfectly (Meat)/1000213911~8.png": "Cooked Perfectly (Meat)/meat_brown-white_curved-irregular_soft-rough_cooked_lamb-chop.png",
  "Cooked Perfectly (Meat)/1000213911~9.png": "Cooked Perfectly (Meat)/meat_brown_flat-irregular_soft-rough_cooked_grilled-steak.png",
  "Cooked Perfectly (Meat)/1000213911~10.png": "Cooked Perfectly (Meat)/meat_brown-red_flat_soft-smooth_cooked_liver-slice.png",
  "Cooked Perfectly (Meat)/1000213911~11.png": "Cooked Perfectly (Meat)/meat_brown_curved-long-round_soft-smooth-wet_cooked_sausage.png",
  "Cooked Perfectly (Meat)/1000213911~12.png": "Cooked Perfectly (Meat)/meat_brown_flat-irregular_soft-rough_cooked_meatloaf-slice.png",
  "Cooked Perfectly (Meat)/1000213911~13.png": "Cooked Perfectly (Meat)/meat_brown_irregular_soft-smooth_cooked_meat-cubes.png",
  "Drinks/file_00000000d1cc71f692761c8cf200ca3b.png": "Drinks/vessel_pink-red-transparent_long-round_hard-smooth_raw_strawberry-water.png",
  "Drinks/1780884213350~6.png": "Drinks/vessel_purple-blue-transparent_long-round_hard-smooth_raw_blueberry-smoothie.png",
  "Drinks/Screenshot_20260607_222838_ChatGPT~2.jpg": "Drinks/vessel_brown-black-transparent_long-round_hard-smooth_raw_boba-milk-tea.jpg",
  "Ingredients/1000214199.png": "Ingredients/pasta_yellow-brown_flat-irregular_hard-dry-brittle_raw_ramen-noodles.png",
  "Ingredients/1000214263.png": "Ingredients/pasta_yellow_long_hard-dry_raw_spaghetti.png",
  "Ingredients/1000214264.png": "Ingredients/pasta_yellow_flat_hard-dry_raw_lasagna-sheets.png",
  "Ingredients/1000214268.png": "Ingredients/pasta_yellow-brown_long-curved-irregular_soft-wet_cooked_noodles.png",
  "Ingredients/1000214269.png": "Ingredients/pasta_yellow_round-long-flat_hard-dry_raw_tagliatelle-nest.png",
  "Ingredients/1000214270.png": "Ingredients/pasta_white_long_hard-dry_raw_rice-vermicelli.png",
  "Ingredients/1000214271.png": "Ingredients/pasta_yellow_curved-irregular_hard-dry_raw_farfalle.png",
  "Ingredients/1000214273.png": "Ingredients/pasta_yellow_long_hard-dry_raw_long-macaroni.png",
  "Ingredients/1780060647533.png": "Ingredients/pasta_yellow-brown_flat-irregular_hard-dry-brittle_raw_ramen-noodles.png"
};

console.log("Renaming food assets...");
for (const [oldRel, newRel] of Object.entries(mapping)) {
  const oldPath = path.join(baseDir, oldRel);
  const newPath = path.join(baseDir, newRel);
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
    console.log(`Renamed: ${oldRel} -> ${newRel}`);
  } else {
    console.log(`Skipped (already renamed or not found): ${oldRel}`);
  }
}

// Generate the JS file mapping
const jsContent = `/**
 * Food Assets Tag Mapping
 * Maps original asset paths to physically renamed files containing culinary tags.
 */
export const FOOD_TAGS = ${JSON.stringify(mapping, null, 2)};
`;

fs.writeFileSync(path.join(baseDir, 'foodTags.js'), jsContent, 'utf-8');
console.log("Created foodTags.js");
