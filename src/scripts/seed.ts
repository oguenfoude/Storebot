import dotenv from "dotenv";
dotenv.config({ quiet: true });

import { ObjectId, WithId } from "mongodb";
import { connectToDB, closeDB } from "../db";
import { Seller } from "../models/seller";
import { Category } from "../models/category";
import { Product } from "../models/product";
import { User } from "../models/user";
import logger from "../helpers/logger";

const log = logger.child({ tag: "Seeder" });

export async function seedDatabase(): Promise<void> {
  log.info("Starting clean database seeding...");
  const db = await connectToDB();

  // 1. Find existing seller or seed default
  let existingSeller: WithId<Seller> | null = await db.collection<Seller>("sellers").findOne({});

  let sellerId: ObjectId;
  let botUsername: string = "simpleteststorebot";
  let planExpiresAt: Date = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  if (!existingSeller) {
    sellerId = new ObjectId();
    const newSeller: Seller = {
      _id: sellerId,
      telegramId: "805926182",
      botUsername,
      botToken: process.env.MANAGER_BOT_TOKEN || "demo_token",
      status: "active",
      planExpiresAt,
      maxProducts: 9999,
      createdAt: new Date(),
    };
    await db.collection<Seller>("sellers").insertOne(newSeller);
    log.info({ sellerId: sellerId.toString() }, "Created demo seller");
  } else {
    sellerId = existingSeller._id;
    botUsername = existingSeller.botUsername || botUsername;
    await db.collection<Seller>("sellers").updateOne(
      { _id: sellerId },
      {
        $set: {
          status: "active",
          planExpiresAt,
          maxProducts: 9999,
        },
      }
    );
    log.info({ sellerId: sellerId.toString(), username: botUsername }, "Updated seller to active (365d plan)");
  }

  // 2. Clear old categories, products, and history for this seller
  await db.collection<Category>("categories").deleteMany({ sellerId });
  await db.collection<Product>("products").deleteMany({ sellerId });
  await db.collection("history").deleteMany({ sellerId });
  log.info("Cleared old categories, products, and history");

  // 3. Create Categories
  const categoryDefs = [
    { name: "Streaming Services" },
    { name: "Software & Licenses" },
    { name: "VPN & Security" },
    { name: "Gaming & Subscriptions" },
  ];

  const categoryMap = new Map<string, ObjectId>();

  for (const cat of categoryDefs) {
    const catId = new ObjectId();
    await db.collection<Category>("categories").insertOne({
      _id: catId,
      sellerId,
      name: cat.name,
      createdDate: new Date(),
      isActive: true,
    });
    categoryMap.set(cat.name, catId);
  }
  log.info({ count: categoryDefs.length }, "Seeded categories");

  // 4. Create Realistic Products with Stocks
  const productsDef = [
    // Streaming
    {
      name: "Netflix Premium 4K UHD (1 Month)",
      category: "Streaming Services",
      price: 10,
      emails: [
        "netflx_premium_us01@fastmail.com:NfPass#2026",
        "netflx_premium_us02@fastmail.com:Stream4K#99",
        "netflx_premium_us03@fastmail.com:CinemaUHD#88",
        "netflx_premium_us04@fastmail.com:MovieBuff#77",
        "netflx_premium_us05@fastmail.com:WatchParty#66",
      ],
      allowPreOrder: true,
    },
    {
      name: "Spotify Premium Family (Lifetime Invite)",
      category: "Streaming Services",
      price: 5,
      emails: [
        "https://www.spotify.com/us/family/join/invite/demoKeyA1",
        "https://www.spotify.com/us/family/join/invite/demoKeyB2",
        "https://www.spotify.com/us/family/join/invite/demoKeyC3",
        "https://www.spotify.com/us/family/join/invite/demoKeyD4",
        "https://www.spotify.com/us/family/join/invite/demoKeyE5",
        "https://www.spotify.com/us/family/join/invite/demoKeyF6",
      ],
      allowPreOrder: true,
    },
    {
      name: "YouTube Premium Individual (1 Year)",
      category: "Streaming Services",
      price: 15,
      emails: [
        "yt_sub_vip1@gmail.com:YtPass2026!",
        "yt_sub_vip2@gmail.com:AdFree2026!",
        "yt_sub_vip3@gmail.com:MusicPremium#1",
      ],
      allowPreOrder: true,
    },
    // Software & Licenses
    {
      name: "Windows 11 Pro Retail License Key",
      category: "Software & Licenses",
      price: 8,
      emails: [
        "W269N-WFGWX-YVC9B-4J6C9-T83GX",
        "MH37W-N47XK-V7XM9-C7227-GCQG9",
        "NRG8B-VKK3Q-CXVCJ-9G2XF-6Q84J",
        "9F26N-4729P-F7N2P-K882R-8R9C9",
        "DPH2V-TTNVB-4X9Q3-TJR4H-KHJW4",
      ],
      allowPreOrder: true,
    },
    {
      name: "Microsoft Office 2021 Professional Plus",
      category: "Software & Licenses",
      price: 12,
      emails: [
        "FXYTK-NJJ8C-GB6DW-3DYQT-6F7TH",
        "KDNJ9-G2MPB-HWJB4-DC6C2-6327Y",
        "3HNTM-49BGQ-R2VBP-Y4R2J-VMR6B",
        "N9G2W-222Q2-4KJ9V-B93T7-R8K2P",
      ],
      allowPreOrder: true,
    },
    {
      name: "Canva Pro Education (Lifetime Access)",
      category: "Software & Licenses",
      price: 6,
      emails: [
        "https://www.canva.com/brand/join?token=demoCanvaToken1",
        "https://www.canva.com/brand/join?token=demoCanvaToken2",
        "https://www.canva.com/brand/join?token=demoCanvaToken3",
        "https://www.canva.com/brand/join?token=demoCanvaToken4",
      ],
      allowPreOrder: true,
    },
    // VPN & Security
    {
      name: "NordVPN 2-Year Ultimate Account",
      category: "VPN & Security",
      price: 14,
      emails: [
        "nord_vip_sec01@proton.me:ShieldSecure#99",
        "nord_vip_sec02@proton.me:NordGuard#2026",
        "nord_vip_sec03@proton.me:CyberSafe#77",
        "nord_vip_sec04@proton.me:PrivAccess#88",
      ],
      allowPreOrder: true,
    },
    {
      name: "ExpressVPN 1-Year High-Speed Key",
      category: "VPN & Security",
      price: 18,
      emails: [
        "EXPR-KEY-99482-USA-2026-X1",
        "EXPR-KEY-99482-USA-2026-X2",
        "EXPR-KEY-99482-USA-2026-X3",
      ],
      allowPreOrder: true,
    },
    // Gaming & Subscriptions
    {
      name: "Discord Nitro 3 Months (Gift Link)",
      category: "Gaming & Subscriptions",
      price: 7,
      emails: [
        "https://discord.gift/DEMONITRO0000000001",
        "https://discord.gift/DEMONITRO0000000002",
        "https://discord.gift/DEMONITRO0000000003",
        "https://discord.gift/DEMONITRO0000000004",
        "https://discord.gift/DEMONITRO0000000005",
      ],
      allowPreOrder: true,
    },
    {
      name: "Xbox Game Pass Ultimate (1 Month Non-Stack)",
      category: "Gaming & Subscriptions",
      price: 9,
      emails: [
        "XBOX-GPU-2948-2948-2948-1111",
        "XBOX-GPU-2948-2948-2948-2222",
        "XBOX-GPU-2948-2948-2948-3333",
        "XBOX-GPU-2948-2948-2948-4444",
      ],
      allowPreOrder: true,
    },
  ];

  for (const p of productsDef) {
    const categoryId = categoryMap.get(p.category) as ObjectId;
    await db.collection<Product>("products").insertOne({
      _id: new ObjectId(),
      sellerId,
      categoryId,
      name: p.name,
      description: `${p.name} - Instant automated digital key delivery.`,
      price: p.price,
      emails: p.emails,
      isAvailable: true,
      allowPreOrder: p.allowPreOrder,
      createdDate: new Date(),
      archive: [],
    });
  }
  log.info({ count: productsDef.length }, "Seeded realistic products with stocks");

  // 5. Seed Customer User with 100 Points balance for instant testing
  const customerTelegramId = existingSeller?.telegramId || "805926182";
  await db.collection<User>("users").deleteMany({ sellerId, telegramId: customerTelegramId });
  await db.collection<User>("users").insertOne({
    _id: new ObjectId(),
    sellerId,
    telegramId: customerTelegramId,
    chatId: customerTelegramId,
    username: "democustomer",
    name: "Demo VIP Customer",
    fullName: "Demo VIP Customer",
    phoneNumber: "+1 555-0199",
    balance: 100,
    isAccepted: true,
    registerDate: new Date(),
    history: [],
  });
  log.info({ telegramId: customerTelegramId, balance: 100 }, "Seeded demo user with 100 pts balance");

  console.log("\n========================================================");
  console.log("DATABASE SEEDING COMPLETE");
  console.log("========================================================");
  console.log(`Seller: @${botUsername} (active)`);
  console.log(`Plan Expires: ${planExpiresAt.toISOString().split("T")[0]}`);
  console.log(`Categories: ${categoryDefs.length} seeded`);
  console.log(`Products: ${productsDef.length} seeded with real stock keys`);
  console.log(`Test Customer: Telegram ID ${customerTelegramId} credited with 100.00 pts`);
  console.log("========================================================\n");
}

if (require.main === module) {
  seedDatabase()
    .then(async () => {
      await closeDB();
      process.exit(0);
    })
    .catch(async (err) => {
      log.error({ err }, "Seeding failed");
      await closeDB();
      process.exit(1);
    });
}
