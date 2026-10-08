// Example trivia content for the seed script. Each row is [statement, correct option, wrong option].
// The seed randomises which of the two options comes first.

export type SeedCard = [string, string, string];

export interface SeedTopic {
  name: string;
  slug: string;
  description: string;
  order: number;
  cards: SeedCard[];
}

export const SEED_TOPICS: SeedTopic[] = [
  {
    name: "Football",
    slug: "football",
    description: "Rules, positions and famous facts from the beautiful game.",
    order: 1,
    cards: [
      ["Number of players a team has on the pitch at kick-off", "11", "9"],
      ["Length of a standard match, not counting stoppage time", "90 minutes", "60 minutes"],
      ["The only player allowed to handle the ball in open play", "Goalkeeper", "Striker"],
      ["Card shown to send a player off", "Red card", "Yellow card"],
      ["Awarded when a defender fouls inside their own penalty area", "Penalty kick", "Corner kick"],
      ["Restart when the ball crosses the touchline", "Throw-in", "Goal kick"],
      ["Three goals by one player in a single match", "Hat-trick", "Brace"],
      ["Country that won the first FIFA World Cup in 1930", "Uruguay", "Brazil"],
      ["Distance of the penalty spot from the goal line", "12 yards", "18 yards"],
      ["Tournament contested by national teams of Africa", "AFCON", "Copa America"],
      ["How often the FIFA World Cup is held", "Every 4 years", "Every 2 years"],
      ["The official who runs the touchline with a flag", "Assistant referee", "Fourth official"],
      ["A goal scored against your own team", "Own goal", "Offside goal"],
      ["Restart after the attacking team puts the ball over the goal line", "Goal kick", "Corner kick"],
      ["Two goals by one player in a single match", "Brace", "Hat-trick"],
      ["Country with the most men's World Cup titles", "Brazil", "Germany"],
      ["A match between two rival teams from the same city", "Derby", "Friendly"],
      ["System that reviews decisions using video footage", "VAR", "DRS"],
      ["Maximum substitutions commonly allowed in a competitive match", "5", "11"],
      ["Shape of the centre mark's surrounding line", "Circle", "Square"],
    ],
  },
  {
    name: "Biology",
    slug: "biology",
    description: "The living world: cells, bodies and plants.",
    order: 2,
    cards: [
      ["The powerhouse of the cell", "Mitochondria", "Nucleus"],
      ["Process plants use to make food from sunlight", "Photosynthesis", "Respiration"],
      ["Organ that pumps blood around the body", "Heart", "Liver"],
      ["Gas humans breathe out as a waste product", "Carbon dioxide", "Oxygen"],
      ["The largest organ of the human body", "Skin", "Brain"],
      ["Molecule that carries genetic information", "DNA", "ATP"],
      ["Blood cells that carry oxygen", "Red blood cells", "White blood cells"],
      ["Green pigment in plant leaves", "Chlorophyll", "Haemoglobin"],
      ["Number of chambers in the human heart", "4", "2"],
      ["Animals that eat only plants", "Herbivores", "Carnivores"],
      ["Part of the plant that absorbs water from the soil", "Roots", "Petals"],
      ["Control centre of the cell", "Nucleus", "Ribosome"],
      ["Organ used by fish to breathe", "Gills", "Lungs"],
      ["Animals with a backbone", "Vertebrates", "Invertebrates"],
      ["The basic unit of life", "Cell", "Atom"],
      ["Hormone that lowers blood sugar", "Insulin", "Adrenaline"],
      ["Number of bones in the adult human body", "206", "106"],
      ["Organ that filters waste from the blood", "Kidney", "Stomach"],
      ["Young form of a frog", "Tadpole", "Larva"],
      ["Blood cells that fight infection", "White blood cells", "Platelets"],
    ],
  },
  {
    name: "Food",
    slug: "food",
    description: "Dishes, ingredients and kitchen knowledge from around the world.",
    order: 3,
    cards: [
      ["Main ingredient of guacamole", "Avocado", "Cucumber"],
      ["Italian dish of dough topped with tomato and cheese", "Pizza", "Risotto"],
      ["West African rice dish cooked in a tomato and pepper base", "Jollof rice", "Fried rice"],
      ["Japanese dish of vinegared rice with fish", "Sushi", "Ramen"],
      ["Fruit used to make wine", "Grapes", "Apples"],
      ["Spice that gives curry its yellow colour", "Turmeric", "Paprika"],
      ["Bean used to make chocolate", "Cocoa bean", "Coffee bean"],
      ["Nigerian snack of fried bean cakes", "Akara", "Puff-puff"],
      ["Dairy product made by churning cream", "Butter", "Yoghurt"],
      ["Vitamin found in large amounts in oranges", "Vitamin C", "Vitamin D"],
      ["Grain used to make most bread", "Wheat", "Rice"],
      ["Mexican flatbread made from corn or wheat", "Tortilla", "Naan"],
      ["Sweet substance made by bees", "Honey", "Syrup"],
      ["Chickpea paste from the Middle East", "Hummus", "Pesto"],
      ["Cooking food in hot oil", "Frying", "Steaming"],
      ["Ingredient that makes bread dough rise", "Yeast", "Salt"],
      ["Starchy tuber pounded to make a Nigerian swallow", "Yam", "Carrot"],
      ["Italian word for noodles made from durum wheat", "Pasta", "Paella"],
      ["Fermented milk drink or food with live cultures", "Yoghurt", "Butter"],
      ["Spicy grilled skewered meat sold on Nigerian streets", "Suya", "Shawarma"],
    ],
  },
];

export const SEED_CAMPAIGN_CARDS: SeedCard[] = [
  ["A balanced breakfast helps you", "Stay focused", "Feel sleepy"],
  ["How many glasses of water a day is a common health tip", "8", "1"],
  ["Fruit known for being rich in potassium", "Banana", "Lemon"],
  ["Best time to brush your teeth", "Morning and night", "Only on weekends"],
  ["Food group that builds muscle", "Protein", "Sugar"],
  ["A healthy snack between meals", "A handful of nuts", "A bag of sweets"],
];
