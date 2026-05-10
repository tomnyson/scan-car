const { MongoClient } = require('mongodb');

let client;
let db;

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.DATABASE_URL || '';
const MONGO_DB = process.env.MONGO_DB || process.env.MONGO_DATABASE || 'scan_car';
const COLLECTION = process.env.MONGO_COLLECTION || 'cars';
const NEW_CAR_COLLECTION = process.env.MONGO_NEW_CAR_COLLECTION || 'new_car_prices';
const SNAPSHOTS_COLLECTION = process.env.MONGO_SNAPSHOTS_COLLECTION || 'snapshots';
const USER_CARS_COLLECTION = process.env.MONGO_USER_CARS_COLLECTION || 'user_cars';

async function initMongo() {
  if (!MONGO_URL) {
    return { ok: false, message: 'Missing MONGO_URL/MONGODB_URI' };
  }
  if (client) {
    return { ok: true, message: 'Mongo already connected' };
  }
  try {
    client = new MongoClient(MONGO_URL);
    await client.connect();
    db = client.db(MONGO_DB);

    // Create indexes for cars collection (individual cars)
    await db.collection(COLLECTION).createIndex({ id: 1 }, { unique: true });
    await db.collection(COLLECTION).createIndex({ source: 1 });
    await db.collection(COLLECTION).createIndex({ updatedAt: -1 });
    await db.collection(COLLECTION).createIndex({ brand: 1 });

    // Create indexes for new car prices
    await db.collection(NEW_CAR_COLLECTION).createIndex({ fetchedAt: -1 });

    // Create indexes for snapshots
    await db.collection(SNAPSHOTS_COLLECTION).createIndex({ fetchedAt: -1 });

    // Create indexes for user cars
    await db.collection(USER_CARS_COLLECTION).createIndex({ createdAt: -1 });
    await db.collection(USER_CARS_COLLECTION).createIndex({ status: 1 });
    await db.collection(USER_CARS_COLLECTION).createIndex({ phone: 1 });

    console.log(`[MongoDB] Connected to ${MONGO_DB}, collections: ${COLLECTION}, ${NEW_CAR_COLLECTION}, ${SNAPSHOTS_COLLECTION}, ${USER_CARS_COLLECTION}`);
    return { ok: true, message: `Mongo connected: ${MONGO_DB}/${COLLECTION}` };
  } catch (error) {
    console.error('[MongoDB] Connection error:', error.message);
    return { ok: false, message: error.message };
  }
}

/**
 * Save individual car documents to MongoDB
 * Each car is saved as a separate document with upsert
 */
async function saveCars(cars, fetchedAt) {
  if (!db) {
    console.warn('[MongoDB] Database not initialized, skipping saveCars');
    return { saved: 0, errors: 0 };
  }

  if (!Array.isArray(cars) || cars.length === 0) {
    console.warn('[MongoDB] No cars to save');
    return { saved: 0, errors: 0 };
  }

  const collection = db.collection(COLLECTION);
  let saved = 0;
  let errors = 0;

  const operations = cars.map(car => ({
    updateOne: {
      filter: { id: car.id },
      update: {
        $set: {
          ...car,
          updatedAt: fetchedAt || Date.now(),
          lastSeen: Date.now()
        },
        $setOnInsert: {
          createdAt: Date.now()
        }
      },
      upsert: true
    }
  }));

  try {
    const result = await collection.bulkWrite(operations, { ordered: false });
    saved = result.upsertedCount + result.modifiedCount;
    console.log(`[MongoDB] Saved ${saved} cars (${result.upsertedCount} new, ${result.modifiedCount} updated)`);
    return { saved, errors: 0 };
  } catch (error) {
    console.error('[MongoDB] Error saving cars:', error.message);
    // Try individual saves if bulk fails
    for (const car of cars) {
      try {
        await collection.updateOne(
          { id: car.id },
          {
            $set: {
              ...car,
              updatedAt: fetchedAt || Date.now(),
              lastSeen: Date.now()
            },
            $setOnInsert: {
              createdAt: Date.now()
            }
          },
          { upsert: true }
        );
        saved++;
      } catch (err) {
        errors++;
        console.warn(`[MongoDB] Failed to save car ${car.id}:`, err.message);
      }
    }
    return { saved, errors };
  }
}

/**
 * Save snapshot metadata (for tracking crawl history)
 */
async function saveSnapshot(snapshot) {
  if (!db) {
    console.warn('[MongoDB] Database not initialized, skipping saveSnapshot');
    return;
  }

  // Save individual cars first
  if (snapshot.cars && snapshot.cars.length > 0) {
    await saveCars(snapshot.cars, snapshot.fetchedAt);
  }

  // Save snapshot metadata (without the cars array to save space)
  const meta = {
    _id: snapshot.fetchedAt,
    fetchedAt: snapshot.fetchedAt,
    carCount: snapshot.cars?.length || 0,
    sources: snapshot.sources || [],
    errors: snapshot.errors || [],
    savedAt: Date.now()
  };

  try {
    await db.collection(SNAPSHOTS_COLLECTION).updateOne(
      { _id: meta._id },
      { $set: meta },
      { upsert: true }
    );
    console.log(`[MongoDB] Saved snapshot metadata (${meta.carCount} cars)`);
  } catch (error) {
    console.error('[MongoDB] Error saving snapshot:', error.message);
  }
}

async function saveNewCarSnapshot(snapshot) {
  if (!db) {
    console.warn('[MongoDB] Database not initialized, skipping saveNewCarSnapshot');
    return;
  }

  const payload = {
    ...snapshot,
    _id: snapshot.fetchedAt,
    savedAt: Date.now()
  };

  try {
    await db.collection(NEW_CAR_COLLECTION).updateOne(
      { _id: payload._id },
      { $set: payload },
      { upsert: true }
    );
    console.log(`[MongoDB] Saved new car snapshot (${snapshot.data?.length || 0} items)`);
  } catch (error) {
    console.error('[MongoDB] Error saving new car snapshot:', error.message);
  }
}

/**
 * Get all cars from MongoDB
 */
async function getCars(options = {}) {
  if (!db) return [];

  const { source, brand, limit = 1000 } = options;
  const query = {};

  if (source) query.source = source;
  if (brand) query.brand = brand;

  try {
    return await db.collection(COLLECTION)
      .find(query)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();
  } catch (error) {
    console.error('[MongoDB] Error getting cars:', error.message);
    return [];
  }
}

/**
 * Get car count from MongoDB
 */
async function getCarCount(options = {}) {
  if (!db) return 0;

  const { source } = options;
  const query = source ? { source } : {};

  try {
    return await db.collection(COLLECTION).countDocuments(query);
  } catch (error) {
    console.error('[MongoDB] Error counting cars:', error.message);
    return 0;
  }
}

/**
 * Save a user-submitted car to MongoDB (pending approval)
 * @param {Object} carData - Car data from user form
 * @returns {Object} - Saved car document with id
 */
async function saveUserCar(carData) {
  if (!db) {
    throw new Error('Database not initialized');
  }

  const now = Date.now();
  const carId = `community-${now}-${Math.random().toString(36).substr(2, 9)}`;

  const userCar = {
    id: carId,
    source: 'community',
    sourceName: 'Cộng đồng',
    title: carData.title || '',
    brand: carData.brand || '',
    brandSlug: (carData.brand || '').toLowerCase().replace(/\s+/g, '-'),
    priceText: carData.priceText || '',
    yearValue: carData.year ? parseInt(carData.year) : null,
    mileage: carData.mileage ? parseInt(carData.mileage) : null,
    seatCount: carData.seats ? parseInt(carData.seats) : null,
    phone: carData.phone || '',
    description: carData.description || '',
    thumbnail: carData.images?.[0] || '',
    images: carData.images || [],
    // Detailed specs
    specs: {
      fuel: carData.fuel || '',           // Nhiên liệu
      transmission: carData.transmission || '', // Hộp số
      bodyType: carData.bodyType || '',   // Kiểu dáng
      drivetrain: carData.drivetrain || '', // Dẫn động
      origin: carData.origin || '',       // Xuất xứ
      exteriorColor: carData.exteriorColor || '', // Màu ngoại thất
      engineCC: carData.engineCC || '',   // Động cơ CC
      version: carData.version || ''      // Phiên bản
    },
    attributes: [],
    url: '',
    status: 'pending', // Pending approval
    createdAt: now,
    updatedAt: now
  };

  // Build attributes array from specs
  const attrMap = [
    { key: 'yearValue', label: 'Năm sản xuất', format: v => String(v) },
    { key: 'mileage', label: 'Số km đã đi', format: v => `${v.toLocaleString('vi-VN')} km` },
    { key: 'seatCount', label: 'Số ghế', format: v => `${v} chỗ` },
    { key: 'specs.fuel', label: 'Nhiên liệu' },
    { key: 'specs.transmission', label: 'Hộp số' },
    { key: 'specs.bodyType', label: 'Kiểu dáng' },
    { key: 'specs.drivetrain', label: 'Dẫn động' },
    { key: 'specs.origin', label: 'Xuất xứ' },
    { key: 'specs.exteriorColor', label: 'Màu ngoại thất' },
    { key: 'specs.engineCC', label: 'Động cơ' },
    { key: 'specs.version', label: 'Phiên bản' },
    { key: 'phone', label: 'Liên hệ' }
  ];

  attrMap.forEach(({ key, label, format }) => {
    const keys = key.split('.');
    let value = userCar;
    for (const k of keys) value = value?.[k];
    if (value) {
      userCar.attributes.push({ label, value: format ? format(value) : String(value) });
    }
  });

  try {
    // Save to user_cars collection only (pending approval)
    await db.collection(USER_CARS_COLLECTION).insertOne(userCar);
    console.log(`[MongoDB] Saved pending user car: ${userCar.id}`);
    return userCar;
  } catch (error) {
    console.error('[MongoDB] Error saving user car:', error.message);
    throw error;
  }
}

/**
 * Get user-submitted cars from MongoDB
 * @param {Object} options - Query options
 * @returns {Array} - List of user cars
 */
async function getUserCars(options = {}) {
  if (!db) return [];

  const { phone, status, limit = 100 } = options;
  const query = {};

  if (phone) query.phone = phone;
  if (status) query.status = status;

  try {
    return await db.collection(USER_CARS_COLLECTION)
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  } catch (error) {
    console.error('[MongoDB] Error getting user cars:', error.message);
    return [];
  }
}

/**
 * Get pending cars for admin approval
 * @returns {Array} - List of pending cars
 */
async function getPendingUserCars() {
  if (!db) return [];

  try {
    return await db.collection(USER_CARS_COLLECTION)
      .find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .toArray();
  } catch (error) {
    console.error('[MongoDB] Error getting pending cars:', error.message);
    return [];
  }
}

/**
 * Approve a user car - makes it visible in main listing
 * @param {string} carId - Car ID to approve
 * @returns {boolean} - Success status
 */
async function approveUserCar(carId) {
  if (!db) return false;

  try {
    // Update status in user_cars
    const car = await db.collection(USER_CARS_COLLECTION).findOne({ id: carId });
    if (!car) return false;

    await db.collection(USER_CARS_COLLECTION).updateOne(
      { id: carId },
      { $set: { status: 'approved', updatedAt: Date.now() } }
    );

    // Add to main cars collection
    const approvedCar = { ...car, status: 'approved', updatedAt: Date.now() };
    await db.collection(COLLECTION).updateOne(
      { id: carId },
      { $set: approvedCar },
      { upsert: true }
    );

    console.log(`[MongoDB] Approved user car: ${carId}`);
    return true;
  } catch (error) {
    console.error('[MongoDB] Error approving car:', error.message);
    return false;
  }
}

/**
 * Reject a user car
 * @param {string} carId - Car ID to reject
 * @param {string} reason - Rejection reason
 * @returns {boolean} - Success status
 */
async function rejectUserCar(carId, reason = '') {
  if (!db) return false;

  try {
    await db.collection(USER_CARS_COLLECTION).updateOne(
      { id: carId },
      { $set: { status: 'rejected', rejectionReason: reason, updatedAt: Date.now() } }
    );

    console.log(`[MongoDB] Rejected user car: ${carId}`);
    return true;
  } catch (error) {
    console.error('[MongoDB] Error rejecting car:', error.message);
    return false;
  }
}

/**
 * Delete a user car by ID
 * @param {string} carId - Car ID to delete
 * @param {string} phone - Phone number for verification
 * @returns {boolean} - Success status
 */
async function deleteUserCar(carId, phone) {
  if (!db) return false;

  try {
    // Delete from user_cars
    const result = await db.collection(USER_CARS_COLLECTION).deleteOne({ id: carId, phone });

    if (result.deletedCount > 0) {
      // Also remove from main cars collection
      await db.collection(COLLECTION).deleteOne({ id: carId });
      console.log(`[MongoDB] Deleted user car: ${carId}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('[MongoDB] Error deleting user car:', error.message);
    return false;
  }
}

/**
 * Toggle visibility of an approved user car (hide/show)
 * @param {string} carId - Car ID to toggle
 * @param {boolean} hidden - true to hide, false to show
 * @returns {boolean} - Success status
 */
async function toggleUserCarVisibility(carId, hidden) {
  if (!db) return false;

  try {
    const car = await db.collection(USER_CARS_COLLECTION).findOne({ id: carId });
    if (!car || car.status !== 'approved') return false;

    // Update hidden flag in user_cars
    await db.collection(USER_CARS_COLLECTION).updateOne(
      { id: carId },
      { $set: { hidden: !!hidden, updatedAt: Date.now() } }
    );

    if (hidden) {
      // Remove from main cars collection when hidden
      await db.collection(COLLECTION).deleteOne({ id: carId });
      console.log(`[MongoDB] Hidden user car: ${carId}`);
    } else {
      // Re-add to main cars collection when shown
      const updatedCar = { ...car, hidden: false, updatedAt: Date.now() };
      await db.collection(COLLECTION).updateOne(
        { id: carId },
        { $set: updatedCar },
        { upsert: true }
      );
      console.log(`[MongoDB] Shown user car: ${carId}`);
    }

    return true;
  } catch (error) {
    console.error('[MongoDB] Error toggling car visibility:', error.message);
    return false;
  }
}

/**
 * Update a user car
 * @param {string} carId - Car ID to update
 * @param {Object} updates - Fields to update
 * @returns {boolean} - Success status
 */
async function updateUserCar(carId, updates) {
  if (!db) return false;

  try {
    const car = await db.collection(USER_CARS_COLLECTION).findOne({ id: carId });
    if (!car) return false;

    // Allowed fields to update
    const allowedFields = ['title', 'brand', 'priceText', 'price', 'yearValue', 'seatCount',
      'mileage', 'phone', 'description', 'thumbnail', 'images', 'specs'];

    const updateData = { updatedAt: Date.now() };
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateData[field] = updates[field];
      }
    }

    // Update in user_cars collection
    await db.collection(USER_CARS_COLLECTION).updateOne(
      { id: carId },
      { $set: updateData }
    );

    // If car is approved and visible, also update in main cars collection
    if (car.status === 'approved' && !car.hidden) {
      await db.collection(COLLECTION).updateOne(
        { id: carId },
        { $set: updateData }
      );
    }

    console.log(`[MongoDB] Updated user car: ${carId}`);
    return true;
  } catch (error) {
    console.error('[MongoDB] Error updating car:', error.message);
    return false;
  }
}

module.exports = {
  initMongo,
  saveCars,
  saveSnapshot,
  saveNewCarSnapshot,
  getCars,
  getCarCount,
  saveUserCar,
  getUserCars,
  getPendingUserCars,
  approveUserCar,
  rejectUserCar,
  deleteUserCar,
  toggleUserCarVisibility,
  updateUserCar
};
