const fs = require('fs');
const { MongoClient } = require('mongodb');

const uri = "mongodb://localhost:27017"; // your MongoDB URI
const client = new MongoClient(uri);

async function importHotels() {
  await client.connect();
  const db = client.db("hotelDB"); // database name
  const collection = db.collection("hotels"); // collection name

  const geojson = JSON.parse(fs.readFileSync('export.geojson', 'utf-8'));

  // Map GeoJSON features to MongoDB documents
  const hotels = geojson.features.map(f => ({
    name: f.properties.name || "Unknown Hotel",
    address: [
      f.properties["addr:street"],
      f.properties["addr:city"],
      f.properties["addr:state"],
      f.properties["addr:postcode"]
    ].filter(Boolean).join(", "),
    location: f.geometry
  }));

  if (hotels.length === 0) {
    console.log("No hotels found in GeoJSON. Aborting import.");
    return;
  }

  await collection.insertMany(hotels);
  console.log(`Imported ${hotels.length} hotels!`);

  // Create geospatial index for real-time location queries
  await collection.createIndex({ location: "2dsphere" });
  console.log("Geospatial index created.");

  client.close();
}

importHotels();