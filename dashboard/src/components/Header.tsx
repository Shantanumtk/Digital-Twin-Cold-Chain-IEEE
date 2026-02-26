'use client';

import { useState } from 'react';
import { Snowflake, RefreshCw, Menu, X, LayoutGrid, Map, Bell, Settings, BarChart3, MessageCircle, Gamepad2 } from 'lucide-react';
import { format } from 'date-fns';

interface HeaderProps {
  lastUpdated: Date | null;
  activeView?: string;
  onViewChange?: (view: string) => void;
  alertCount?: number;
}

export default function Header({ lastUpdated, activeView = 'dashboard', onViewChange, alertCount = 0 }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutGrid className="w-5 h-5" /> },
    { id: 'map', label: 'Live Map', icon: <Map className="w-5 h-5" /> },
    { id: 'alerts', label: 'Alerts', icon: <Bell className="w-5 h-5" />, badge: alertCount },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-5 h-5" /> },
    { id: 'chat', label: 'AI Query', icon: <MessageCircle className="w-5 h-5" /> },
    { id: 'simulate', label: 'Simulator', icon: <Gamepad2 className="w-5 h-5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
  ];

  const handleNavClick = (viewId: string) => {
    onViewChange?.(viewId);
    setMobileMenuOpen(false);
  };

  return (
    <header className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <Snowflake className="w-8 h-8 text-blue-600" />
            <div className="hidden sm:block">
              <h1 className="text-xl font-bold text-gray-900">Cold Chain Digital Twin</h1>
              <p className="text-xs text-gray-500">Real-time Monitoring</p>
            </div>
            <div className="sm:hidden">
              <h1 className="text-lg font-bold text-gray-900">CCDT</h1>
            </div>
          </div>

          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`relative flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                  activeView === item.id ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {item.icon}
                <span className="text-sm font-medium">{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-sm text-gray-500">
              <RefreshCw className="w-4 h-4" />
              {lastUpdated ? <span>{format(lastUpdated, 'HH:mm:ss')}</span> : <span>Loading...</span>}
            </div>

            <button
              className="lg:hidden p-2 rounded-lg hover:bg-gray-100 relative"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="w-6 h-6 text-gray-600" />
              ) : (
                <>
                  <Menu className="w-6 h-6 text-gray-600" />
                  {alertCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                      {alertCount > 9 ? '9+' : alertCount}
                    </span>
                  )}
                </>
              )}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="lg:hidden border-t py-4">
            <nav className="flex flex-col gap-2">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${
                    activeView === item.id ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {item.icon}
                    <span className="font-medium">{item.label}</span>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1">
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-2 px-4 pt-4 mt-4 border-t text-sm text-gray-500">
              <RefreshCw className="w-4 h-4" />
              {lastUpdated ? <span>Updated: {format(lastUpdated, 'HH:mm:ss')}</span> : <span>Loading...</span>}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}