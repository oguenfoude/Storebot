import { ObjectId } from "mongodb";

// Mock dependencies
jest.mock("../db", () => ({
  connectToDB: jest.fn(),
}));

jest.mock("../commands/start", () => ({
  showMainMenu: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../languages", () => ({
  t: jest.fn().mockReturnValue({
    buy: {
      invalidProductId: "Invalid product ID",
      outOfStock: "Out of stock",
      insufficientBalance: "Insufficient balance",
      success: "Purchase successful! Email: ${email}",
      errorPurchasing: "Error purchasing",
    },
    general: {
      userNotFound: "User not found",
      errorTryAgainLater: "Error, try again later",
    },
    messages: {
      insufficientFunds: "Insufficient funds. Need ${needed} more.",
    },
    menu: {
      buttonBalance: "Balance",
      buttonProducts: "Products",
      buttonAccount: "Account",
      buttonSupport: "Support",
    },
    admin: {
      purchaseAlert: "Purchase alert",
      buyerInfo: "Buyer info",
      buyerName: "Name: ${name}",
      buyerPhone: "Phone: ${phone}",
      buyerTelegramId: "ID: ${id}",
      productInfo: "Product info",
      productName: "Product: ${name}",
      categoryName: "Category: ${category}",
      price: "Price: ${price}",
      remainingQty: "Remaining: ${quantity}",
      transactionInfo: "Transaction info",
      prevBalance: "Previous: ${balance}",
      newBalance: "New: ${balance}",
      amountPaid: "Paid: ${price}",
      transactionDate: "Date: ${date}",
      transactionId: "TX: ${id}",
      receiptNote: "Receipt note",
    },
    support: {
      insufficientBalance: "Contact support for balance issues",
      contactLink: "Support: ${url}",
    },
    buttons: {
      confirmPurchase: "Confirm Purchase",
      cancelPurchase: "Cancel Purchase",
      preorderProduct: "Pre-order Product",
      backToMainMenu: "Back to Main Menu",
    },
  }),
}));

jest.mock("../helpers/adminNotificationHelper", () => ({
  sendToAdmin: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../bot/manager", () => ({
  BotManager: {
    getBotForMessage: jest.fn().mockReturnValue({
      api: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    }),
    getPrimaryBot: jest.fn().mockReturnValue({
      api: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    }),
  },
}));

import { handleBuyConfirmation } from "../commands/buy";
import { connectToDB } from "../db";

function makeMockCtx(telegramId: string = "123456789") {
  return {
    from: { id: parseInt(telegramId) },
    reply: jest.fn().mockResolvedValue(undefined),
    session: {
      awaitingBuyConfirmationProductId: null as string | null,
    },
  } as any;
}

describe("Purchase Flow — Atomic $pop", () => {
  let mockDb: any;
  let mockProductsCollection: any;
  let mockUsersCollection: any;
  let mockCategoriesCollection: any;
  let mockHistoryCollection: any;

  const sellerId = new ObjectId();
  const productId = new ObjectId();
  const userId = new ObjectId();
  const categoryId = new ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();

    mockProductsCollection = {
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    mockUsersCollection = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    mockCategoriesCollection = {
      findOne: jest.fn().mockResolvedValue({ name: "Netflix" }),
    };
    mockHistoryCollection = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };

    mockDb = {
      collection: jest.fn().mockImplementation((name: string) => {
        if (name === "products") return mockProductsCollection;
        if (name === "users") return mockUsersCollection;
        if (name === "categories") return mockCategoriesCollection;
        if (name === "history") return mockHistoryCollection;
        return { findOne: jest.fn(), updateOne: jest.fn(), insertOne: jest.fn() };
      }),
    };

    (connectToDB as jest.Mock).mockResolvedValue(mockDb);
  });

  it("successfully delivers email on sufficient balance", async () => {
    const emails = ["a@test.com", "b@test.com", "c@test.com"];
    const price = 9;

    // $pop returns document BEFORE pop — last element is the one removed
    mockProductsCollection.findOneAndUpdate.mockResolvedValue({
      _id: productId,
      sellerId,
      name: "Netflix 1 Month",
      price,
      emails: [...emails], // before state
      categoryId,
      isAvailable: true,
    });

    mockUsersCollection.findOne.mockResolvedValue({
      _id: userId,
      telegramId: "123456789",
      sellerId,
      balance: 50,
      fullName: "Test User",
      phoneNumber: "0555123456",
    });

    // Atomic balance deduction returns the updated user doc
    mockUsersCollection.findOneAndUpdate.mockResolvedValue({
      _id: userId,
      telegramId: "123456789",
      sellerId,
      balance: 41, // 50 - 9
      fullName: "Test User",
      phoneNumber: "0555123456",
    });

    const ctx = makeMockCtx("123456789");
    await handleBuyConfirmation(ctx, productId.toString(), sellerId);

    // $pop was called
    expect(mockProductsCollection.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: expect.any(ObjectId),
        isAvailable: true,
        emails: { $exists: true, $ne: [] },
      }),
      { $pop: { emails: 1 } },
      { returnDocument: "before" }
    );

    // Atomic balance deduction with $gte guard + $inc + inline history push
    expect(mockUsersCollection.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: "123456789",
        sellerId,
        balance: { $gte: 9 },
      }),
      expect.objectContaining({
        $inc: expect.objectContaining({ balance: -9 }),
      }),
      { returnDocument: "after" }
    );

    // Product availability updated
    expect(mockProductsCollection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.any(ObjectId) }),
      expect.objectContaining({
        $set: expect.objectContaining({ isAvailable: true }), // 2 emails left
      })
    );

    // History was written
    expect(mockHistoryCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "purchase",
        productName: "Netflix 1 Month",
        price: 9,
      })
    );
  });

  it("rolls back email when balance is insufficient", async () => {
    const emails = ["a@test.com"];
    const price = 25;

    mockProductsCollection.findOneAndUpdate.mockResolvedValue({
      _id: productId,
      sellerId,
      name: "Expensive Product",
      price,
      emails: [...emails],
      categoryId,
      isAvailable: true,
    });

    mockUsersCollection.findOne.mockResolvedValue({
      _id: userId,
      telegramId: "123456789",
      sellerId,
      balance: 10, // less than price
      fullName: "Poor User",
    });

    // Atomic $gte guard fails (balance 10 < price 25) → returns null
    mockUsersCollection.findOneAndUpdate.mockResolvedValue(null);

    const ctx = makeMockCtx("123456789");
    await handleBuyConfirmation(ctx, productId.toString(), sellerId);

    // Email was pushed back to position 0
    expect(mockProductsCollection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.any(ObjectId) }),
      {
        $push: {
          emails: { $each: ["a@test.com"], $position: 0 },
        },
      }
    );

    // Insufficient balance message sent
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Contact support")
    );

    // No history was written for failed purchase
    expect(mockHistoryCollection.insertOne).not.toHaveBeenCalled();
  });

  it("sets isAvailable to false when last email is popped", async () => {
    const emails = ["last@test.com"];
    const price = 5;

    mockProductsCollection.findOneAndUpdate.mockResolvedValue({
      _id: productId,
      sellerId,
      name: "Last Key",
      price,
      emails: [...emails],
      categoryId,
      isAvailable: true,
    });

    mockUsersCollection.findOne.mockResolvedValue({
      _id: userId,
      telegramId: "123456789",
      sellerId,
      balance: 100,
      fullName: "Rich User",
    });

    mockUsersCollection.findOneAndUpdate.mockResolvedValue({
      _id: userId,
      telegramId: "123456789",
      sellerId,
      balance: 95, // 100 - 5
      fullName: "Rich User",
    });

    const ctx = makeMockCtx("123456789");
    await handleBuyConfirmation(ctx, productId.toString(), sellerId);

    // isAvailable should be set to false (0 emails remaining)
    expect(mockProductsCollection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.any(ObjectId) }),
      expect.objectContaining({
        $set: expect.objectContaining({ isAvailable: false }),
      })
    );
  });

  it("returns early when product is not found (out of stock)", async () => {
    mockProductsCollection.findOneAndUpdate.mockResolvedValue(null);

    const ctx = makeMockCtx("123456789");
    await handleBuyConfirmation(ctx, productId.toString(), sellerId);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Out of stock")
    );
    expect(mockUsersCollection.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mockUsersCollection.updateOne).not.toHaveBeenCalled();
  });

  it("returns early when user is not found", async () => {
    mockProductsCollection.findOneAndUpdate.mockResolvedValue({
      _id: productId,
      sellerId,
      name: "Product",
      price: 5,
      emails: ["a@test.com"],
      categoryId,
      isAvailable: true,
    });

    mockUsersCollection.findOne.mockResolvedValue(null);

    const ctx = makeMockCtx("123456789");
    await handleBuyConfirmation(ctx, productId.toString(), sellerId);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("User not found")
    );
  });

  it("returns early for invalid product ID", async () => {
    const ctx = makeMockCtx("123456789");
    await handleBuyConfirmation(ctx, "not-a-valid-id", sellerId);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Invalid product ID")
    );
    expect(connectToDB).not.toHaveBeenCalled();
  });

  it("archives the sale on the product document", async () => {
    const emails = ["sold@test.com"];
    const price = 15;

    mockProductsCollection.findOneAndUpdate.mockResolvedValue({
      _id: productId,
      sellerId,
      name: "Archived Product",
      price,
      emails: [...emails],
      categoryId,
      isAvailable: true,
    });

    mockUsersCollection.findOne.mockResolvedValue({
      _id: userId,
      telegramId: "123456789",
      sellerId,
      balance: 50,
      fullName: "Buyer",
      phoneNumber: "0555999999",
    });

    mockUsersCollection.findOneAndUpdate.mockResolvedValue({
      _id: userId,
      telegramId: "123456789",
      sellerId,
      balance: 35, // 50 - 15
      fullName: "Buyer",
      phoneNumber: "0555999999",
    });

    const ctx = makeMockCtx("123456789");
    await handleBuyConfirmation(ctx, productId.toString(), sellerId);

    // Product archive should contain the sale record
    expect(mockProductsCollection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.any(ObjectId) }),
      expect.objectContaining({
        $push: expect.objectContaining({
          archive: expect.objectContaining({
            emailPassword: "sold@test.com",
            price: 15,
          }),
        }),
      })
    );
  });

  it("uses $gte balance guard to prevent double-delivery race on concurrent purchases", async () => {
    const emails = ["a@test.com", "b@test.com"];
    const price = 9;

    mockProductsCollection.findOneAndUpdate.mockResolvedValue({
      _id: productId,
      sellerId,
      name: "Racy Product",
      price,
      emails: [...emails],
      categoryId,
      isAvailable: true,
    });

    mockUsersCollection.findOne.mockResolvedValue({
      _id: userId,
      telegramId: "123456789",
      sellerId,
      balance: 10, // barely enough — exactly 1 purchase succeeds
      fullName: "Race User",
      phoneNumber: "0555111222",
    });

    // The second concurrent call would overdraw — $gte guard rejects it
    // by returning null. We simulate the atomic guarantee: only first gives back updated user.
    let callCount = 0;
    mockUsersCollection.findOneAndUpdate.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          _id: userId,
          telegramId: "123456789",
          sellerId,
          balance: 1, // 10 - 9
          fullName: "Race User",
          phoneNumber: "0555111222",
        };
      }
      return null; // $gte fails on second concurrent purchase
    });

    const ctx1 = makeMockCtx("123456789");
    await handleBuyConfirmation(ctx1, productId.toString(), sellerId);

    // Verify the atomic updateOne used $gte guard + $inc
    expect(mockUsersCollection.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: "123456789",
        sellerId,
        balance: { $gte: 9 },
      }),
      expect.objectContaining({
        $inc: expect.objectContaining({ balance: -9 }),
      }),
      { returnDocument: "after" }
    );
  });
});
