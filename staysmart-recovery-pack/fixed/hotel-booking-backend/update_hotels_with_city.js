// update_hotels_with_city.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import fetch from "node-fetch";

// Load .env
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_CONNECTION_STRING)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error(err));

// Hotel model
import Hotel from "./models/Hotel.js";

// Reverse geocode using Nominatim
async function getCity(lat, lon) {
  if (!lat || !lon) return "Unknown";
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;

  try {
    const response = await fetch(url, { headers: { "User-Agent": "HotelSeeder/1.0" } });
    const data = await response.json();
    return data.address?.city || data.address?.town || data.address?.village || "Unknown";
  } catch (err) {
    console.error("Reverse geocode error:", err);
    return "Unknown";
  }
}

// Rate-limit function: process 1 hotel per 1 second
async function updateHotels() {
  const hotels = await Hotel.find({});
  console.log(`Found ${hotels.length} hotels`);

  for (let i = 0; i < hotels.length; i++) {
    const hotel = hotels[i];
    const latitude = hotel.location?.latitude || 0;
    const longitude = hotel.location?.longitude || 0;

    // Reverse geocode city if empty
    let city = hotel.city;
    if (!city || city === "") {
      city = await getCity(latitude, longitude);
    }

    // Update hotel document
    await Hotel.updateOne(
      { _id: hotel._id },
      {
        $set: {
          city,
          location: {
            type: "Point",
            coordinates: [longitude, latitude]
          }
        }
      }
    );

    if ((i + 1) % 50 === 0) console.log(`Updated ${i + 1}/${hotels.length} hotels`);

    // Wait 1s between requests to avoid Nominatim blocking
    await new Promise(res => setTimeout(res, 1000));
  }

  // Create geospatial index if not exists
  await Hotel.collection.createIndex({ location: "2dsphere" });
  console.log("Geospatial index created");

  console.log("All hotels updated!");
  mongoose.disconnect();
}

updateHotels();