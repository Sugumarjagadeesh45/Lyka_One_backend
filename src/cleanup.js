require('dotenv').config();
const mongoose = require('mongoose');
const env = require('./config/env');
const Activity = require('./models/Activity');

async function cleanup() {
  try {
    await mongoose.connect(env.MONGO_URI);
    console.log('Connected to DB');

    // Time: 8:00 AM IST on August 22, 2026
    const cutoffDate = new Date('2026-08-22T08:00:00+05:30');

    console.log('Deleting activities before:', cutoffDate.toLocaleString());
    
    const result = await Activity.deleteMany({
      createdAt: { $lt: cutoffDate }
    });

    console.log(`Successfully deleted ${result.deletedCount} old activities.`);
    
    process.exit(0);
  } catch (err) {
    console.error('Error during cleanup:', err);
    process.exit(1);
  }
}

cleanup();
