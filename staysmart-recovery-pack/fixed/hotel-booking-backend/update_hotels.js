// update_hotels.js
import mongoose from "mongoose";
import dotenv from "dotenv";

// Load .env
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_CONNECTION_STRING)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

// Hotel model
import Hotel from "./models/Hotel.js";

async function updateHotels() {
  try {
    // Find all hotels
    const hotels = await Hotel.find({});
    console.log(`Found ${hotels.length} hotels`);

    const bulkOps = hotels.map(hotel => {
      const longitude = hotel.location?.longitude || 0;
      const latitude = hotel.location?.latitude || 0;

      return {
        updateOne: {
          filter: { _id: hotel._id },
          update: {
            $set: {
              city: hotel.city || "Unknown",  // default city if empty
              location: {
                type: "Point",
                coordinates: [longitude, latitude]
              }
            }
          }
        }
      };
    });

    if (bulkOps.length > 0) {
      const result = await Hotel.bulkWrite(bulkOps);
      console.log("Hotels updated:", result.modifiedCount);
    } else {
      console.log("No hotels to update");
    }

    // Create geospatial index
    await Hotel.collection.createIndex({ location: "2dsphere" });
    console.log("Geospatial index created");

    mongoose.disconnect();
  } catch (err) {
    console.error(err);
    mongoose.disconnect();
  }
}

updateHotels();