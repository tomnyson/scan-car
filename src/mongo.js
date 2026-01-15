const { MongoClient } = require('mongodb');

let client;
let db;

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.DATABASE_URL || '';
const MONGO_DB = process.env.MONGO_DB || process.env.MONGO_DATABASE || 'scan_car';
const COLLECTION = process.env.MONGO_COLLECTION || 'cars';
const NEW_CAR_COLLECTION = process.env.MONGO_NEW_CAR_COLLECTION || 'new_car_prices';

async function initMongo() {
  if (!MONGO_URL) {
    return { ok: false, message: 'Missing MONGO_URL/MONGODB_URI' };
  }
  if (client) {
    return { ok: true, message: 'Mongo already connected' };
  }
  client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(MONGO_DB);
  await db.collection(COLLECTION).createIndex({ fetchedAt: -1 });
  await db.collection(NEW_CAR_COLLECTION).createIndex({ fetchedAt: -1 });
  return { ok: true, message: `Mongo connected: ${MONGO_DB}/${COLLECTION}` };
}

async function saveSnapshot(snapshot) {
  if (!db) return;
  const payload = {
    ...snapshot,
    _id: snapshot.fetchedAt,
    savedAt: Date.now()
  };
  await db.collection(COLLECTION).updateOne({ _id: payload._id }, { $set: payload }, { upsert: true });
}

async function saveNewCarSnapshot(snapshot) {
  if (!db) return;
  const payload = {
    ...snapshot,
    _id: snapshot.fetchedAt,
    savedAt: Date.now()
  };
  await db.collection(NEW_CAR_COLLECTION).updateOne({ _id: payload._id }, { $set: payload }, { upsert: true });
}

module.exports = { initMongo, saveSnapshot, saveNewCarSnapshot };
