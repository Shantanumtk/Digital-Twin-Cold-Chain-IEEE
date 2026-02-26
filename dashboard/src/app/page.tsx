'use client';

import { useState, useEffect } from 'react';
import { useApi } from '@/hooks/useApi';
import Header from '@/components/Header';
import StatsCards from '@/components/StatsCards';
import AssetGrid from '@/components/AssetGrid';
import AssetMap from '@/components/AssetMap';
import AlertPanel from '@/components/AlertPanel';
import AssetDetail from '@/components/AssetDetail';
import ChatWidget from '@/components/ChatWidget';
import { Asset } from '@/types';

export default function Dashboard() {
  // Settings state
  const [refreshInterval, setRefreshInterval] = useState<number>(5000);
  const [tempUnit, setTempUnit] = useState<string>('celsius');
  const [truckWarningTemp, setTruckWarningTemp] = useState<number>(-10);
  const [truckCriticalTemp, setTruckCriticalTemp] = useState<number>(-5);
  const [roomWarningTemp, setRoomWarningTemp] = useState<number>(-15);
  const [roomCriticalTemp, setRoomCriticalTemp] = useState<number>(-10);
  const [settingsSaved, setSettingsSaved] = useState<boolean>(false);
  const [settingsLoaded, setSettingsLoaded] = useState<boolean>(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('dashboardSettings');
    if (savedSettings) {
      const settings = JSON.parse(savedSettings);
      setRefreshInterval(settings.refreshInterval || 5000);
      setTempUnit(settings.tempUnit || 'celsius');
      setTruckWarningTemp(settings.truckWarningTemp ?? -10);
      setTruckCriticalTemp(settings.truckCriticalTemp ?? -5);
      setRoomWarningTemp(settings.roomWarningTemp ?? -15);
      setRoomCriticalTemp(settings.roomCriticalTemp ?? -10);
    }
    setSettingsLoaded(true);
  }, []);

  // Save settings function
  const saveSettings = () => {
    const settings = {
      refreshInterval,
      tempUnit,
      truckWarningTemp,
      truckCriticalTemp,
      roomWarningTemp,
      roomCriticalTemp,
    };
    localStorage.setItem('dashboardSettings', JSON.stringify(settings));
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 3000);
  };

  // Reset settings function
  const resetSettings = () => {
    setRefreshInterval(5000);
    setTempUnit('celsius');
    setTruckWarningTemp(-10);
    setTruckCriticalTemp(-5);
    setRoomWarningTemp(-15);
    setRoomCriticalTemp(-10);
  };

  // Convert temperature based on unit
  const convertTemp = (celsius: number | undefined): string => {
    if (celsius === undefined || celsius === null) return '--';
    if (tempUnit === 'fahrenheit') {
      return ((celsius * 9) / 5 + 32).toFixed(1) + '°F';
    }
    return celsius.toFixed(1) + '°C';
  };

  const { stats, assets, alerts, loading, error, lastUpdated } = useApi(refreshInterval);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [activeView, setActiveView] = useState<string>('dashboard');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredAssets = assets.filter((asset) => {
    if (stateFilter && asset.state !== stateFilter) return false;
    if (typeFilter && asset.asset_type !== typeFilter) return false;
    if (searchQuery && !asset.asset_id.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const trucks = assets.filter((a) => a.asset_type === 'refrigerated_truck');
  const coldRooms = assets.filter((a) => a.asset_type === 'cold_room');

  if (!settingsLoaded || loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Connection Error</h2>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  const handleSelectAssetById = (id: string) => {
    const asset = assets.find((a) => a.asset_id === id);
    if (asset) setSelectedAsset(asset);
  };

  // Export to CSV function
  const exportToCSV = () => {
    const headers = ['Asset ID', 'Type', 'Temperature (°C)', 'Humidity (%)', 'Door Open', 'Compressor', 'State'];
    const rows = assets.map((a) => [
      a.asset_id,
      a.asset_type === 'refrigerated_truck' ? 'Truck' : 'Cold Room',
      a.temperature_c?.toFixed(1) || '',
      a.humidity_pct?.toFixed(1) || '',
      a.door_open ? 'Yes' : 'No',
      a.compressor_running ? 'Running' : 'Off',
      a.state,
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coldchain-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderContent = () => {
    switch (activeView) {
      case 'chat':
        return (
          <ChatWidget
            agent="query"
            title=" Cold Chain Query Agent "
            placeholder="Ask about your cold chain data..."
            suggestions={[
              "Which assets are critical right now?",
              "Why is truck01 temperature rising?",
              "Show me all breaches in the last 24 hours",
              "Compare all trucks side by side",
              "What is the current state of sensor-room-site1-room1?",
            ]}
          />
        );

      case 'simulate':
        return (
          <ChatWidget
            agent="simulate"
            title=" Simulation Controller "
            placeholder="Describe a scenario to simulate..."
            suggestions={[
              "Open truck02's door for 3 minutes",
              "Simulate compressor failure on truck05",
              "Trigger a power outage at site1 for 10 minutes",
              "Scale the fleet to 20 trucks",
              "What is the current simulator status?",
            ]}
          />
        );

      case 'map':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <AssetMap
                trucks={trucks}
                onSelectAsset={setSelectedAsset}
                selectedAssetId={selectedAsset?.asset_id}
              />
            </div>
            <div>
              {selectedAsset ? (
                <AssetDetail
                  asset={selectedAsset}
                  onClose={() => setSelectedAsset(null)}
                  convertTemp={convertTemp}
                />
              ) : (
                <AlertPanel alerts={alerts} onSelectAsset={handleSelectAssetById} />
              )}
            </div>
          </div>
        );

      case 'alerts':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="text-lg font-semibold mb-4">Active Alerts ({alerts.length})</h2>
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {alerts.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No active alerts 🎉</p>
                ) : (
                  alerts.map((alert, index) => (
                    <div
                      key={`${alert.asset_id}-${index}`}
                      className={`border-l-4 rounded-r-lg p-4 cursor-pointer hover:shadow-md ${
                        alert.state === 'CRITICAL'
                          ? 'border-red-500 bg-red-50'
                          : 'border-yellow-500 bg-yellow-50'
                      }`}
                      onClick={() => handleSelectAssetById(alert.asset_id)}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-semibold">{alert.asset_id}</p>
                          {alert.reasons?.map((reason, i) => (
                            <p key={i} className="text-sm text-gray-600 mt-1">
                              {reason}
                            </p>
                          ))}
                        </div>
                        <span
                          className={`px-2 py-1 rounded text-xs text-white ${
                            alert.state === 'CRITICAL' ? 'bg-red-500' : 'bg-yellow-500'
                          }`}
                        >
                          {alert.state}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              {selectedAsset && (
                <AssetDetail
                  asset={selectedAsset}
                  onClose={() => setSelectedAsset(null)}
                  convertTemp={convertTemp}
                />
              )}
            </div>
          </div>
        );

      case 'analytics':
        return (
          <div className="space-y-6">
            {/* Export Button */}
            <div className="flex justify-end">
              <button
                onClick={exportToCSV}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Export CSV
              </button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm text-gray-500 mb-1">Avg Temperature (Trucks)</h3>
                <p className="text-2xl font-bold text-blue-600">
                  {trucks.length > 0
                    ? convertTemp(
                        trucks.reduce((sum, t) => sum + (t.temperature_c || 0), 0) / trucks.length
                      )
                    : '--'}
                </p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm text-gray-500 mb-1">Avg Temperature (Rooms)</h3>
                <p className="text-2xl font-bold text-cyan-600">
                  {coldRooms.length > 0
                    ? convertTemp(
                        coldRooms.reduce((sum, t) => sum + (t.temperature_c || 0), 0) /
                          coldRooms.length
                      )
                    : '--'}
                </p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm text-gray-500 mb-1">Doors Open</h3>
                <p className="text-2xl font-bold text-orange-600">
                  {assets.filter((a) => a.door_open).length}
                </p>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm text-gray-500 mb-1">Compressors Off</h3>
                <p className="text-2xl font-bold text-red-600">
                  {assets.filter((a) => !a.compressor_running).length}
                </p>
              </div>
            </div>

            {/* State Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">State Distribution</h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Normal</span>
                      <span className="text-sm font-medium">{stats?.state_counts.NORMAL || 0}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-4">
                      <div
                        className="bg-green-500 h-4 rounded-full transition-all"
                        style={{
                          width: `${
                            stats ? (stats.state_counts.NORMAL / stats.total_assets) * 100 : 0
                          }%`,
                        }}
                      ></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Warning</span>
                      <span className="text-sm font-medium">{stats?.state_counts.WARNING || 0}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-4">
                      <div
                        className="bg-yellow-500 h-4 rounded-full transition-all"
                        style={{
                          width: `${
                            stats ? (stats.state_counts.WARNING / stats.total_assets) * 100 : 0
                          }%`,
                        }}
                      ></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Critical</span>
                      <span className="text-sm font-medium">
                        {stats?.state_counts.CRITICAL || 0}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-4">
                      <div
                        className="bg-red-500 h-4 rounded-full transition-all"
                        style={{
                          width: `${
                            stats ? (stats.state_counts.CRITICAL / stats.total_assets) * 100 : 0
                          }%`,
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Asset Types</h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Refrigerated Trucks</span>
                      <span className="text-sm font-medium">
                        {stats?.asset_types.refrigerated_truck || 0}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-4">
                      <div
                        className="bg-indigo-500 h-4 rounded-full transition-all"
                        style={{
                          width: `${
                            stats
                              ? (stats.asset_types.refrigerated_truck / stats.total_assets) * 100
                              : 0
                          }%`,
                        }}
                      ></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Cold Rooms</span>
                      <span className="text-sm font-medium">
                        {stats?.asset_types.cold_room || 0}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-4">
                      <div
                        className="bg-blue-500 h-4 rounded-full transition-all"
                        style={{
                          width: `${
                            stats ? (stats.asset_types.cold_room / stats.total_assets) * 100 : 0
                          }%`,
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Temperature Overview Table */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Temperature Overview</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-4">Asset</th>
                      <th className="text-left py-2 px-4">Type</th>
                      <th className="text-left py-2 px-4">Temperature</th>
                      <th className="text-left py-2 px-4">Humidity</th>
                      <th className="text-left py-2 px-4">Door</th>
                      <th className="text-left py-2 px-4">Compressor</th>
                      <th className="text-left py-2 px-4">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((asset) => (
                      <tr
                        key={asset.asset_id}
                        className="border-b hover:bg-gray-50 cursor-pointer"
                        onClick={() => {
                          setSelectedAsset(asset);
                          setActiveView('dashboard');
                        }}
                      >
                        <td className="py-2 px-4 font-medium">{asset.asset_id}</td>
                        <td className="py-2 px-4 text-gray-600">
                          {asset.asset_type === 'refrigerated_truck' ? 'Truck' : 'Room'}
                        </td>
                        <td className="py-2 px-4">{convertTemp(asset.temperature_c)}</td>
                        <td className="py-2 px-4">{asset.humidity_pct?.toFixed(1)}%</td>
                        <td className="py-2 px-4">
                          <span
                            className={asset.door_open ? 'text-orange-600 font-medium' : 'text-gray-500'}
                          >
                            {asset.door_open ? 'Open' : 'Closed'}
                          </span>
                        </td>
                        <td className="py-2 px-4">
                          <span
                            className={
                              asset.compressor_running ? 'text-green-600' : 'text-red-600 font-medium'
                            }
                          >
                            {asset.compressor_running ? 'Running' : 'Off'}
                          </span>
                        </td>
                        <td className="py-2 px-4">
                          <span
                            className={`px-2 py-1 rounded text-xs text-white ${
                              asset.state === 'NORMAL'
                                ? 'bg-green-500'
                                : asset.state === 'WARNING'
                                ? 'bg-yellow-500'
                                : 'bg-red-500'
                            }`}
                          >
                            {asset.state}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );

      case 'settings':
        return (
          <div className="space-y-6">
            {/* Success Message */}
            {settingsSaved && (
              <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                Settings saved successfully!
              </div>
            )}

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Dashboard Settings</h3>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Auto-refresh Interval
                  </label>
                  <select
                    className="w-full md:w-64 px-4 py-2 border rounded-lg bg-white"
                    value={refreshInterval}
                    onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  >
                    <option value={3000}>3 seconds</option>
                    <option value={5000}>5 seconds</option>
                    <option value={10000}>10 seconds</option>
                    <option value={30000}>30 seconds</option>
                    <option value={60000}>1 minute</option>
                  </select>
                  <p className="text-sm text-gray-500 mt-1">
                    How often the dashboard fetches new data
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Temperature Unit
                  </label>
                  <select
                    className="w-full md:w-64 px-4 py-2 border rounded-lg bg-white"
                    value={tempUnit}
                    onChange={(e) => setTempUnit(e.target.value)}
                  >
                    <option value="celsius">Celsius (°C)</option>
                    <option value="fahrenheit">Fahrenheit (°F)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Temperature Thresholds</h3>
              <p className="text-sm text-gray-500 mb-4">
                Note: Thresholds are configured on the server. These values are for display reference only.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium text-gray-700 mb-3">Refrigerated Trucks</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Warning Above</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={truckWarningTemp}
                          onChange={(e) => setTruckWarningTemp(Number(e.target.value))}
                          className="w-24 px-3 py-2 border rounded-lg"
                        />
                        <span className="text-gray-500">°C</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Critical Above</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={truckCriticalTemp}
                          onChange={(e) => setTruckCriticalTemp(Number(e.target.value))}
                          className="w-24 px-3 py-2 border rounded-lg"
                        />
                        <span className="text-gray-500">°C</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-gray-700 mb-3">Cold Rooms</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Warning Above</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={roomWarningTemp}
                          onChange={(e) => setRoomWarningTemp(Number(e.target.value))}
                          className="w-24 px-3 py-2 border rounded-lg"
                        />
                        <span className="text-gray-500">°C</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Critical Above</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={roomCriticalTemp}
                          onChange={(e) => setRoomCriticalTemp(Number(e.target.value))}
                          className="w-24 px-3 py-2 border rounded-lg"
                        />
                        <span className="text-gray-500">°C</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">System Information</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-600">API Endpoint</span>
                  <span className="font-mono text-gray-800">/api (proxy)</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-600">Refresh Interval</span>
                  <span className="font-medium">{refreshInterval / 1000}s</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-600">Total Assets</span>
                  <span className="font-medium">{stats?.total_assets || 0}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-600">Active Alerts</span>
                  <span className="font-medium">{stats?.active_alerts || 0}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-600">Last Updated</span>
                  <span className="font-medium">{lastUpdated?.toLocaleTimeString() || '--'}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-gray-600">Temperature Unit</span>
                  <span className="font-medium">
                    {tempUnit === 'celsius' ? 'Celsius' : 'Fahrenheit'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-4">
              <button
                onClick={resetSettings}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Reset to Defaults
              </button>
              <button
                onClick={saveSettings}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Save Settings
              </button>
            </div>
          </div>
        );

      default:
        return (
          <>
            {stats && <StatsCards stats={stats} />}

            <div className="flex flex-wrap gap-4 items-center">
              <input
                type="text"
                placeholder="Search assets..."
                className="px-4 py-2 border rounded-lg bg-white w-full sm:w-auto"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              <select
                className="px-4 py-2 border rounded-lg bg-white"
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
              >
                <option value="">All States</option>
                <option value="NORMAL">Normal</option>
                <option value="WARNING">Warning</option>
                <option value="CRITICAL">Critical</option>
              </select>

              <select
                className="px-4 py-2 border rounded-lg bg-white"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All Types</option>
                <option value="refrigerated_truck">Trucks</option>
                <option value="cold_room">Cold Rooms</option>
              </select>

              <span className="text-sm text-gray-500">
                Showing {filteredAssets.length} of {assets.length} assets
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <AssetGrid
                  assets={filteredAssets}
                  onSelectAsset={setSelectedAsset}
                  selectedAssetId={selectedAsset?.asset_id}
                  convertTemp={convertTemp}
                />
              </div>
              <div>
                {selectedAsset ? (
                  <AssetDetail
                    asset={selectedAsset}
                    onClose={() => setSelectedAsset(null)}
                    convertTemp={convertTemp}
                  />
                ) : (
                  <AlertPanel alerts={alerts} onSelectAsset={handleSelectAssetById} />
                )}
              </div>
            </div>
          </>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Header
        lastUpdated={lastUpdated}
        activeView={activeView}
        onViewChange={setActiveView}
        alertCount={alerts.length}
      />

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">{renderContent()}</main>
    </div>
  );
}