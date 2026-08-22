require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Lead = require('./src/models/Lead');
const Activity = require('./src/models/Activity');
const env = require('./src/config/env');

async function reset() {
  await mongoose.connect(env.MONGO_URI);
  await User.deleteMany({});
  await Lead.deleteMany({});
  await Activity.deleteMany({});
  console.log("DB dropped. Now seeding...");
  
  // call the existing seed logic
  require('./src/seed/seed.js');
}

reset();
