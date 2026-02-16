
import React, { useState } from "react";
import {
  Menu,
  Settings as SettingsIcon,
  Minus,
  Square,
  X,
  Monitor,
  MonitorOff,
} from "lucide-react";
import { DeviceInfo } from "../services/interaction-client";

interface HeaderProps {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  trans: any;
  interactionStatus: "disconnected" | "connecting" | "connected";
  deviceList: DeviceInfo[];
  onOpenSettings: () => void;
  onWindowCommand: (
    cmd: "window:minimize" | "window:maximize" | "window:close",
  ) => void;
  canControlWindow: boolean;
  onReconnect: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isSidebarOpen,
  toggleSidebar,
  trans,
  interactionStatus,
  deviceList,
  onOpenSettings,
  onWindowCommand,
  canControlWindow,
  onReconnect,
}) => {
  const [showDeviceList, setShowDeviceList] = useState(false);

  return (
    <header className="app-header">
      <div className="header-left">
        <button
          onClick={toggleSidebar}
          className="icon-btn"
          title={isSidebarOpen ? trans.sidebar.collapse : trans.sidebar.expand}
        >
          <Menu size={18} />
        </button>
        <h1 className="header-title">{trans.appTitle}</h1>
        <button
          onClick={() => setShowDeviceList(!showDeviceList)}
          className="icon-btn"
          title={`Interaction Layer: ${interactionStatus}`}
          style={{
            marginLeft: "8px",
            position: "relative",
            color:
              interactionStatus === "connected"
                ? "#4caf50"
                : interactionStatus === "connecting"
                  ? "#ffc107"
                  : "var(--text-secondary)",
          }}
        >
          {interactionStatus === "connected" ? (
            <Monitor size={18} />
          ) : (
            <MonitorOff size={18} />
          )}
          {deviceList.length > 0 && (
            <span
              style={{
                position: "absolute",
                top: "-2px",
                right: "-2px",
                backgroundColor: "#0e639c",
                color: "white",
                fontSize: "9px",
                borderRadius: "50%",
                width: "12px",
                height: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {deviceList.length}
            </span>
          )}
        </button>

        {showDeviceList && (
          <div
            style={{
              position: "absolute",
              top: "40px",
              left: "260px",
              width: "250px",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-lg)",
              zIndex: 1000,
              padding: "8px",
            }}
          >
            <div
              style={{
                fontWeight: 600,
                marginBottom: "8px",
                paddingBottom: "8px",
                borderBottom: "1px solid var(--border-color)",
                color: "var(--text-primary)",
              }}
            >
              Connected Devices
            </div>

            {interactionStatus === "disconnected" && (
              <div
                style={{
                  marginBottom: "8px",
                  paddingBottom: "8px",
                  borderBottom: "1px solid var(--border-color)",
                }}
              >
                <button
                  className="btn btn-primary"
                  style={{
                    width: "100%",
                    fontSize: "0.85rem",
                    padding: "6px",
                  }}
                  onClick={onReconnect}
                >
                  Reconnect Server
                </button>
              </div>
            )}

            {deviceList.length === 0 ? (
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: "0.9rem",
                  padding: "4px",
                }}
              >
                No devices connected
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                {deviceList.map((device) => (
                  <div
                    key={device.id}
                    style={{
                      padding: "8px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-tertiary)",
                      fontSize: "0.9rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          color: "var(--text-primary)",
                          fontWeight: 500,
                        }}
                      >
                        {device.name}
                      </span>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "2px 6px",
                          borderRadius: "10px",
                          backgroundColor:
                            device.status === "active"
                              ? "#4caf5020"
                              : "#ffc10720",
                          color:
                            device.status === "active"
                              ? "#4caf50"
                              : "#ffc107",
                        }}
                      >
                        {device.status}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                        marginTop: "2px",
                      }}
                    >
                      {device.type} • {device.deviceId.slice(0, 8)}...
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="window-controls">
        <button
          onClick={onOpenSettings}
          className="icon-btn"
          title={trans.settings}
          style={{ marginRight: "16px" }}
        >
          <SettingsIcon size={20} />
        </button>

        <button
          onClick={() => onWindowCommand("window:minimize")}
          disabled={!canControlWindow}
          className="window-control-btn"
          title="Minimize"
        >
          <Minus size={18} />
        </button>
        <button
          onClick={() => onWindowCommand("window:maximize")}
          disabled={!canControlWindow}
          className="window-control-btn"
          title="Maximize"
        >
          <Square size={16} />
        </button>
        <button
          onClick={() => onWindowCommand("window:close")}
          disabled={!canControlWindow}
          className="window-control-btn close"
          title="Close"
        >
          <X size={18} />
        </button>
      </div>
    </header>
  );
};
