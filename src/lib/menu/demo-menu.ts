/**
 * The Pakistani demo menu (prices in rupees; sizes as [name, rupees, isDefault]).
 * Used by `npm run seed:menu`, the bot eval (tests/bot-eval) and bot unit tests,
 * so they all agree on the same items. Loaded Fries is out of stock at the
 * first branch on purpose.
 */
export type DemoGroupKey = "pizzaExtras" | "drink" | "spice";

export type DemoItem = {
  name: string;
  nameUr?: string;
  description: string;
  price?: number;
  sizes?: [name: string, rupees: number, isDefault?: boolean][];
  groups?: DemoGroupKey[];
  removable?: string[];
  aliases: string[];
  tags?: ("bestseller" | "spicy" | "new" | "vegetarian" | "deal" | "popular")[];
  prep?: number;
  outOfStockAtFirstBranch?: boolean;
};

export const DEMO_MENU: { name: string; nameUr?: string; items: DemoItem[] }[] = [
  {
    name: "Pizza",
    nameUr: "پیزا",
    items: [
      {
        name: "Chicken Tikka Pizza",
        nameUr: "چکن تکہ پیزا",
        description: "Tikka chicken, onion, capsicum, olives, mozzarella",
        sizes: [["Small", 899], ["Medium", 1399, true], ["Large", 1850]],
        groups: ["pizzaExtras"],
        removable: ["Onion", "Olives", "Capsicum"],
        aliases: ["tikka pizza", "chicken tikka", "tikka", "تکہ پیزا"],
        tags: ["bestseller"],
        prep: 20,
      },
      {
        name: "Fajita Pizza",
        description: "Fajita chicken, onion, capsicum, mozzarella",
        sizes: [["Small", 949], ["Medium", 1449, true], ["Large", 1899]],
        groups: ["pizzaExtras"],
        removable: ["Onion", "Capsicum"],
        aliases: ["fajita", "fajeta", "chicken fajita", "فجیتا"],
        tags: ["spicy"],
        prep: 20,
      },
    ],
  },
  {
    name: "Burgers",
    nameUr: "برگر",
    items: [
      {
        name: "Zinger Burger",
        nameUr: "زنگر برگر",
        description: "Crispy chicken fillet, lettuce, mayo",
        price: 550,
        removable: ["Mayo", "Lettuce"],
        aliases: ["zinger", "zngr", "zinger burger", "zingr", "زنگر"],
        tags: ["bestseller"],
        prep: 10,
      },
      {
        name: "Beef Smash Burger",
        description: "Double smashed beef, cheese, house sauce",
        price: 850,
        removable: ["Onion", "Pickles", "Cheese"],
        aliases: ["smash burger", "beef burger", "smash", "smashed burger"],
        tags: ["new"],
        prep: 12,
      },
      {
        name: "Zinger Deal",
        description: "Zinger Burger, regular fries and a drink",
        price: 799,
        groups: ["drink"],
        removable: ["Mayo"],
        aliases: ["zinger deal", "zinger meal", "deal", "ڈیل"],
        tags: ["deal"],
        prep: 12,
      },
    ],
  },
  {
    name: "Desi",
    nameUr: "دیسی",
    items: [
      {
        name: "Chicken Karahi",
        nameUr: "چکن کڑاہی",
        description: "Fresh tomato and green chilli karahi, made to order",
        sizes: [["Half", 1600], ["Full", 2900, true]],
        groups: ["spice"],
        aliases: ["karahi", "karai", "kadai", "chicken karai", "کڑاہی"],
        tags: ["popular"],
        prep: 30,
      },
    ],
  },
  {
    name: "Rice",
    nameUr: "چاول",
    items: [
      {
        name: "Chicken Biryani",
        nameUr: "چکن بریانی",
        description: "Sindhi-style biryani with raita and salad",
        price: 450,
        groups: ["spice"],
        removable: ["Aloo"],
        aliases: ["biryani", "biriyani", "briyani", "chicken biryani", "بریانی"],
        tags: ["bestseller", "spicy"],
        prep: 10,
      },
    ],
  },
  {
    name: "Sides",
    items: [
      {
        name: "Loaded Fries",
        description: "Fries, cheese sauce, jalapeños, mayo",
        price: 450,
        removable: ["Jalapeños", "Mayo"],
        aliases: ["loaded", "loaded fries", "cheese fries", "fries"],
        prep: 8,
        outOfStockAtFirstBranch: true,
      },
      {
        name: "Garlic Naan",
        nameUr: "گارلک نان",
        description: "Fresh tandoori naan with garlic butter",
        price: 120,
        aliases: ["naan", "nan", "garlic nan", "garlic naan", "نان"],
        tags: ["vegetarian"],
        prep: 5,
      },
      {
        name: "Raita",
        nameUr: "رائتہ",
        description: "Yogurt with mint and cucumber",
        price: 80,
        aliases: ["raita", "raitha", "dahi", "رائتہ"],
        tags: ["vegetarian"],
      },
    ],
  },
  {
    name: "Deals",
    nameUr: "ڈیلز",
    items: [
      {
        name: "Friday Deal: 2 Zinger + 1.5L Coke",
        description: "2 Zinger Burgers and a chilled 1.5 litre Coke",
        price: 1199,
        aliases: ["friday deal", "jumma deal", "jummah deal", "2 zinger coke deal"],
        tags: ["deal"],
        prep: 12,
      },
      {
        name: "Student Deal",
        description: "Zinger Burger, regular fries and a soft drink (weekdays 12–4 pm)",
        price: 599,
        aliases: ["student deal", "students deal", "student offer"],
        tags: ["deal"],
        prep: 12,
      },
    ],
  },
  {
    name: "Drinks",
    nameUr: "مشروبات",
    items: [
      {
        name: "Mint Margarita",
        description: "Fresh mint, lemon and soda",
        price: 350,
        aliases: ["mint marg", "margarita", "mint margarita", "mint lemonade"],
        tags: ["vegetarian"],
      },
      {
        name: "Coke 1.5L",
        description: "Chilled Coca-Cola, 1.5 litre",
        price: 250,
        aliases: ["coke", "coca cola", "cold drink", "1.5 coke", "big coke", "کوک"],
      },
    ],
  },
];

export const DEMO_GROUPS: Record<DemoGroupKey, { name: string; nameUr?: string; min: number; max: number; options: [string, number, boolean?][] }> = {
  pizzaExtras: {
    name: "Pizza Extras",
    min: 0,
    max: 3,
    options: [["Extra Cheese", 150], ["Jalapeños", 100], ["Extra Sauce", 50]],
  },
  drink: {
    name: "Choose your drink",
    nameUr: "مشروب منتخب کریں",
    min: 1,
    max: 1,
    options: [["Coke", 0], ["Sprite", 0], ["Mint Margarita", 100]],
  },
  spice: {
    name: "Spice level",
    nameUr: "مرچ",
    min: 1,
    max: 1,
    options: [["Mild", 0], ["Medium", 0, true], ["Spicy", 0]],
  },
};

/** Offers on the demo menu (Phase 7C). Days are ISO (1 = Monday); times are the restaurant's local time. */
export const DEMO_OFFERS: {
  title: string;
  titleUr?: string;
  description: string;
  itemName: string;
  daysOfWeek: number[] | null;
  startTime: string | null;
  endTime: string | null;
}[] = [
  {
    title: "Friday Deal",
    titleUr: "جمعہ ڈیل",
    description: "Every Friday: 2 Zinger Burgers + 1.5L Coke",
    itemName: "Friday Deal: 2 Zinger + 1.5L Coke",
    daysOfWeek: [5],
    startTime: null,
    endTime: null,
  },
  {
    title: "Student Deal",
    description: "Weekdays 12 pm to 4 pm: Zinger, fries and a drink",
    itemName: "Student Deal",
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "12:00",
    endTime: "16:00",
  },
];

/** Answers the demo bot knows (Phase 7C). */
export const DEMO_FAQS: { question: string; answer: string; keywords: string[] }[] = [
  { question: "Parking available?", answer: "Yes, free parking is available in front of the restaurant.", keywords: ["parking", "car", "gari", "park"] },
  { question: "Family hall?", answer: "Yes, we have a separate family hall upstairs.", keywords: ["family", "hall", "families", "ladies"] },
  {
    question: "Birthday / party arrangements?",
    answer: "Yes, we arrange birthdays for up to 40 guests. Please book one day in advance.",
    keywords: ["birthday", "party", "event", "booking", "celebration"],
  },
  { question: "Is the food halal?", answer: "Yes, all our meat is 100% halal.", keywords: ["halal", "halaal", "haram"] },
  {
    question: "Which areas do you deliver to?",
    answer: "We deliver to Clifton, DHA, Defence View and Saddar.",
    keywords: ["areas", "area", "deliver", "delivery area", "dha", "kahan tak"],
  },
];

/** First branch location for the demo (Clifton, Karachi). */
export const DEMO_BRANCH_LOCATION = {
  address: "Plot 12-C, Block 5, Clifton",
  area: "Clifton",
  latitude: 24.8138,
  longitude: 67.0299,
};
