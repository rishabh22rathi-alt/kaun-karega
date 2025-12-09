import { NextResponse } from "next/server";
import {
  findProvidersByCategoryAndArea,
  savePendingCategory,
  saveUserRequest,
} from "@/lib/googleSheets";

const MASTER_CATEGORIES = [
  "Carpenter",
  "Electrician",
  "Plumber",
  "AC Mechanic",
  "Washing Machine Repair",
  "RO Technician",
  "Painter",
  "House Cleaner",
  "Sofa Cleaner",
  "Car Cleaner",
  "Kitchen Deep Cleaner",
  "Play Group / Pre-School Teacher",
  "Home Tutor (Nursery-5)",
  "Home Tutor (6-10)",
  "Accounts",
  "Maths",
  "English",
  "Science",
  "Economics",
  "Business Studies",
  "Dance Teacher",
  "Drawing Teacher",
  "Music Teacher",
  "Yoga Instructor",
  "Skating Coach",
  "Karate Coach",
  "Car Driver",
  "Auto Driver",
  "Bike Mechanic",
  "Car Mechanic",
  "Cook",
  "Babysitter / Nanny",
  "Elderly Care / Aya",
  "Gardener",
  "Security Guard",
  "Photographer",
  "Videographer",
  "Event Helper",
  "Makeup Artist",
  "Mehendi Artist",
  "Tailor",
  "Delivery Boy",
  "Labor / Helper (General)",
  "Loader / Unloader",
];

const MASTER_AREAS = [
  "Sardarpura",
  "Shastri Nagar",
  "Ratanada",
  "Pal Road",
  "Bhagat Ki Kothi",
  "Chopasni Housing Board",
  "Chopasni Road",
  "Basni",
  "Paota",
  "Mandore",
  "Residency Road",
  "Rai Ka Bagh",
  "High Court Colony",
  "Civil Lines",
  "Kamla Nehru Nagar",
  "Kudi Bhagtasni Housing Board",
  "Banar",
  "Pratap Nagar",
  "Nayapura",
  "Shikargarh",
  "Air Force Area",
  "MIA",
  "Jalori Gate",
  "Sojati Gate",
  "Clock Tower",
  "Nandri",
  "Paota Circle",
  "Kabir Nagar",
  "Vivek Vihar",
  "BJS Colony",
  "Umaid Stadium",
  "Ashapurna Valley",
  "Sangriya",
  "Mogra",
  "Khema Ka Kuan",
  "Idgah",
  "Agolai",
  "Tinwari",
  "Laxmi Nagar",
  "Rajiv Gandhi Colony",
  "Sursagar",
  "Rikhtiya Bheruji",
  "Sivanchi Gate",
  "Chand Pole",
  "Soorsagar Road",
  "Panch Batti Circle",
  "New Power House",
  "Madar",
  "Mahamandir",
];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { category, area, details, createdAt } = body || {};

    if (!category || !area) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    await saveUserRequest({
      category,
      area,
      details,
      createdAt,
    });

    const providers = await findProvidersByCategoryAndArea(category, area);

    if (!MASTER_AREAS.includes(area)) {
      await savePendingCategory({
        category: "__NEW_AREA__",
        area,
        details: details || "",
      });
    }

    if (!MASTER_CATEGORIES.includes(category)) {
      await savePendingCategory({
        category,
        area,
        details,
      });
    }

    return Response.json({ ok: true, providers });

  } catch (error: any) {
    console.error("submit-request error", error);

    return Response.json(
      { error: error?.message || "Failed to submit request" },
      { status: 500 }
    );
  }
}
