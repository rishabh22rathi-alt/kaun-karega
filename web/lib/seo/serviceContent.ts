/**
 * SEO Phase 2.0a — hand-authored content for the first 5 service
 * landing pages.
 *
 * Every entry here is original copy written for Kaun Karega — NOT
 * paraphrased from Justdial, Sulekha, IndiaMart, or any other
 * directory. Reviewers: please refuse PRs that introduce LLM-
 * generated paraphrases of competitor copy. Hand-authored content
 * is the single largest defence against the doorway-page / thin-
 * content penalty for /services/[category] pages.
 *
 * Each entry pairs with an allow-list slug in lib/seo/slugs.ts.
 * The two lists MUST stay in sync — a slug without content (or
 * vice-versa) is a build-time-detectable bug and the e2e spec
 * actively asserts the symmetry.
 *
 * Content guidelines:
 *   - Mention "Jodhpur" naturally, not as a keyword stuff.
 *   - Use concrete service vocabulary the local market actually
 *     uses (e.g. MCB, inverter, geyser, distemper) — but only
 *     where it makes sense for a customer to read.
 *   - No fake claims: no "top-rated", no "5-star", no specific
 *     pricing, no provider counts (those are runtime, not content).
 *   - FAQs answer questions a real customer might type into
 *     Google. Each answer 30-60 words. Avoid keyword stuffing.
 *   - relatedServiceSlugs MUST point to other entries in this map
 *     — never invent a slug. The e2e spec enforces this.
 */

import { listAllowedServices } from "./slugs";

export type FaqEntry = {
  q: string;
  a: string;
};

export type ServiceContent = {
  canonicalName: string;
  slug: string;
  h1: string;
  shortIntro: string;
  description: string;
  commonJobs: readonly string[];
  faq: readonly FaqEntry[];
  relatedServiceSlugs: readonly string[];
};

// Keyed by slug for direct lookup. Use `getServiceContent(slug)` so
// callers get a friendly null on miss rather than `undefined`.
const SERVICE_CONTENT: Record<string, ServiceContent> = {
  electrician: {
    canonicalName: "Electrician",
    slug: "electrician",
    h1: "Electrician in Jodhpur",
    shortIntro:
      "Find a verified local electrician in Jodhpur for wiring, fan installation, switch repair, MCB changes and inverter work.",
    description:
      "Household and shop electrical work in Jodhpur covers a wide range — from a single fan that has stopped working to a full rewiring after monsoon damage. Kaun Karega connects you with verified local electricians who handle small repairs and larger jobs both. Most providers respond the same day and can reach Jodhpur neighbourhoods like Sardarpura, Ratanada, Paota and Shastri Nagar quickly. Post your task with what is needed and where, and we will match you with electricians who serve your area.",
    commonJobs: [
      "Fan installation and repair",
      "Switch and socket replacement",
      "MCB and meter box work",
      "Inverter and battery setup",
      "Wiring for new rooms",
      "Geyser and water-heater wiring",
    ],
    faq: [
      {
        q: "How fast will an electrician respond on Kaun Karega?",
        a: "Most verified electricians in Jodhpur respond the same day when you post a task in the morning. Urgency depends on the work — small repairs are often handled within a few hours, while full rewiring may be scheduled for the next day.",
      },
      {
        q: "Is Kaun Karega free to use for customers?",
        a: "Yes. Posting your task and getting matched with a local electrician is free for customers. You only pay the electrician directly for the work they do — Kaun Karega never charges a commission on top.",
      },
      {
        q: "Are electricians on Kaun Karega verified?",
        a: "Every provider goes through phone verification before they can receive work requests, and admin approval before being marked verified. The verified badge means we have confirmed the provider's identity and basic service history.",
      },
    ],
    relatedServiceSlugs: ["plumber", "ac-repair", "carpenter"],
  },

  plumber: {
    canonicalName: "Plumber",
    slug: "plumber",
    h1: "Plumber in Jodhpur",
    shortIntro:
      "Get matched with a verified local plumber in Jodhpur for tap repair, toilet leaks, motor service, bathroom fittings and overhead tank work.",
    description:
      "Water-supply problems in Jodhpur range from a dripping kitchen tap to an overhead tank that has stopped filling. Kaun Karega connects you with local plumbers who handle daily repairs as well as full bathroom fittings. Providers serve common Jodhpur localities including Chopasni, Paota, Sardarpura and Mahaveer Nagar. Many also handle motor and submersible-pump issues that are common in summer when water pressure drops. Post your task with the issue and your area, and we will match you with a plumber who can come the same day.",
    commonJobs: [
      "Tap and faucet repair",
      "Toilet flush and leak fixing",
      "Submersible motor service",
      "Overhead tank and pipe work",
      "Bathroom and washbasin fitting",
      "Geyser pipe installation",
    ],
    faq: [
      {
        q: "Can I get a plumber the same day in Jodhpur?",
        a: "Yes, most leaks, blocked drains and tap repairs are handled the same day if you post early. Larger jobs like full bathroom fitting are usually scheduled within one to two days based on the plumber's availability.",
      },
      {
        q: "Do plumbers on Kaun Karega bring their own tools?",
        a: "Verified plumbers carry the standard tools for repair work — wrenches, pipe cutters, basic spares. For parts like faucets, valves or specific pipes you may need to provide the item or pay separately for them.",
      },
      {
        q: "How is pricing decided?",
        a: "Kaun Karega does not set or collect prices. The plumber will share their charge directly based on the work and any parts required. Compare quotes when multiple providers respond before confirming the job.",
      },
    ],
    relatedServiceSlugs: ["electrician", "carpenter", "painter"],
  },

  "ac-repair": {
    canonicalName: "AC Repair",
    slug: "ac-repair",
    h1: "AC Repair in Jodhpur",
    shortIntro:
      "Book a verified AC repair technician in Jodhpur for not-cooling complaints, gas top-up, deep cleaning, installation and uninstallation.",
    description:
      "Jodhpur summers make a working AC essential. Kaun Karega connects you with verified AC repair technicians for window units, split systems and inverter ACs across the city. Common issues we cover include not-cooling complaints, gas leak and top-up, water dripping, indoor-unit noise and full deep cleaning before the summer season. Technicians serve neighbourhoods like Sardarpura, Ratanada, Shastri Nagar, Paota and the cantonment area. Post your task with the AC type and the issue you are facing, and we will match you with a technician quickly.",
    commonJobs: [
      "Not-cooling diagnosis",
      "Gas top-up and leak repair",
      "Deep cleaning before summer",
      "Split AC installation",
      "Window AC uninstallation",
      "Water leak and drain fixing",
    ],
    faq: [
      {
        q: "How quickly can an AC technician reach me in Jodhpur?",
        a: "During peak summer most verified technicians try to respond within a few hours. Off-season the response is usually the same or next day. Posting early in the morning gives you the best chance of a same-day visit.",
      },
      {
        q: "Do I need to specify the AC brand and type?",
        a: "It helps. Mention if it is a window, split or inverter AC, and the brand if you know it. Technicians can come prepared with the right gas, tools and basic spare parts which avoids a second visit.",
      },
      {
        q: "Is AC gas refill included in the service price?",
        a: "Gas refill is usually charged separately because the cost varies by AC capacity. The technician will confirm the price before topping up the gas. Ask for an estimate when the technician inspects the unit.",
      },
    ],
    relatedServiceSlugs: ["electrician", "plumber", "carpenter"],
  },

  carpenter: {
    canonicalName: "Carpenter",
    slug: "carpenter",
    h1: "Carpenter in Jodhpur",
    shortIntro:
      "Connect with a local carpenter in Jodhpur for furniture repair, door and window work, modular cabinet fitting and custom woodwork.",
    description:
      "From a wobbling chair to a full kitchen modular fitting, carpentry work in Jodhpur covers both quick repairs and larger projects. Kaun Karega connects you with verified carpenters who handle furniture repair, door and window adjustment, lock and hinge replacement, and custom cabinet work. Providers serve areas across the city including Paota, Sardarpura, Ratanada and Chopasni Housing Board. Post your task with the work needed and your area, and a carpenter from your locality will reach out.",
    commonJobs: [
      "Furniture repair and polishing",
      "Door and window hinge fitting",
      "Modular kitchen cabinet work",
      "Wardrobe and almirah making",
      "Lock and latch replacement",
      "Custom shelves and dressing units",
    ],
    faq: [
      {
        q: "Can a carpenter come the same day for small repairs?",
        a: "Yes, simple jobs like fixing a door hinge, polishing a chair or replacing a latch are usually handled the same day. Larger custom work such as a wardrobe or full kitchen unit needs measurement, design and timing.",
      },
      {
        q: "Do carpenters bring their own materials?",
        a: "Carpenters bring standard tools and basic consumables. Materials like wood, ply, laminate, hinges and handles are usually purchased separately based on the design. The carpenter can guide you on the right material for your budget.",
      },
      {
        q: "How long does a custom wardrobe take in Jodhpur?",
        a: "Most custom wardrobes take three to seven working days from measurement to fitting depending on the size, design and material. Polishing or laminate work may add a day or two. The carpenter will share the exact timeline before starting.",
      },
    ],
    relatedServiceSlugs: ["painter", "electrician", "plumber"],
  },

  painter: {
    canonicalName: "Painter",
    slug: "painter",
    h1: "Painter in Jodhpur",
    shortIntro:
      "Hire a verified painter in Jodhpur for interior and exterior painting, distemper work, putty finishing and texture or POP design.",
    description:
      "Painting work in Jodhpur ranges from a single-room touch-up before a festival to a full house repaint after monsoon. Kaun Karega connects you with verified painters who handle interior and exterior work, putty and primer finishing, distemper and emulsion painting, and texture or POP design. Providers cover the main Jodhpur localities including Sardarpura, Ratanada, Paota, Shastri Nagar and Chopasni. Post your task with the rooms or area to be painted, and painters from your neighbourhood will reach out with their availability.",
    commonJobs: [
      "Single-room repaint",
      "Full house interior painting",
      "Exterior weather-coat painting",
      "Putty and primer finishing",
      "Distemper and emulsion work",
      "Texture and POP design",
    ],
    faq: [
      {
        q: "How long does it take to paint a house in Jodhpur?",
        a: "A single room takes about one day. A full 2 BHK interior repaint usually takes four to seven working days depending on the surface preparation, putty layers and the type of finish you choose. Exterior work depends on the weather.",
      },
      {
        q: "Do painters bring paint, or do I have to buy it?",
        a: "Painters bring brushes, rollers, ladders and standard tools. Paint is usually purchased separately so you can choose the brand, finish and shade. Painters can help you pick the right product based on your room and budget.",
      },
      {
        q: "Can I get a quote before confirming the painter?",
        a: "Yes. Post your task with rough area and finish details. Painters will respond with their per-square-foot rate or a flat quote after seeing the surface. Compare two or three responses before confirming the job.",
      },
    ],
    relatedServiceSlugs: ["carpenter", "plumber", "electrician"],
  },
};

/**
 * Look up the hand-authored content for a slug. Returns null if the
 * slug is not in the content map (which, by contract, is also not in
 * the allow-list).
 */
export function getServiceContent(slug: string): ServiceContent | null {
  return SERVICE_CONTENT[slug] ?? null;
}

/**
 * Returns the full content map. Used by tests + the (future)
 * /services catalog page.
 */
export function listServiceContent(): readonly ServiceContent[] {
  // Stable iteration order matches the allow-list order in slugs.ts
  // so the catalog page and tests render entries deterministically.
  return listAllowedServices()
    .map((entry) => SERVICE_CONTENT[entry.slug])
    .filter((entry): entry is ServiceContent => Boolean(entry));
}
