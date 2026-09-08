import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Default center: Tà Năng trekking region, Vietnam
const DEFAULT_CENTER: [number, number] = [11.5544, 108.5381];

export const LiveMapWidget: React.FC = () => {
  return (
    <div className="w-full h-[500px] rounded-xl overflow-hidden shadow-sm border border-slate-200">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={13}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={DEFAULT_CENTER}>
          <Popup>
            <div className="font-sans">
              <p className="font-semibold text-sm">Tà Năng Trailhead</p>
              <p className="text-xs text-slate-500">Basecamp Node / Gateway Active</p>
            </div>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
};
