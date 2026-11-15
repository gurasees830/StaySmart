import xml.etree.ElementTree as ET
import json

osm_file = "india-hotels.osm"
json_file = "india-hotels.json"

count = 0  # hotel counter
with open(json_file, "w", encoding="utf-8") as f:
    f.write("[\n")
    first = True
    for event, elem in ET.iterparse(osm_file):
        if elem.tag == "node":
            tags = {}
            for tag in elem.findall("tag"):
                k = tag.attrib.get('k')
                v = tag.attrib.get('v')
                if k and v:
                    tags[k] = v
            if tags.get("tourism") == "hotel":
                count += 1
                name = tags.get("name", "Unknown Hotel")
                addr = ", ".join([tags.get(f"addr:{x}", "") for x in ["street","city","state","postcode"] if tags.get(f"addr:{x}")])
                lat = float(elem.attrib.get("lat", 0))
                lon = float(elem.attrib.get("lon", 0))
                hotel = {
                    "name": name,
                    "address": addr,
                    "location": {"type": "Point", "coordinates": [lon, lat]}
                }
                if not first:
                    f.write(",\n")
                json.dump(hotel, f, ensure_ascii=False)
                first = False
        elem.clear()
    f.write("\n]")

print(f"Conversion complete! Hotels found: {count}")