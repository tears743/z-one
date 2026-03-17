import { LarkBridge } from "./lark";
import { getAppSettings } from "../db";
import { logger } from "../logger";
import { DeviceConfig } from "../../renderer/src/types/settings";

/**
 * DeviceManager — manages all device bridges (Lark, hardware, etc.)
 * Reads device configs from DB and starts/stops bridges accordingly.
 */
class DeviceManager {
  private larkBridges: Map<string, LarkBridge> = new Map();

  /**
   * Start all enabled devices from settings
   */
  async startAll() {
    const settings = getAppSettings();
    const devices: DeviceConfig[] = settings?.devices || [];

    for (const device of devices) {
      if (!device.enabled) continue;

      switch (device.type) {
        case "lark":
          await this.startLarkDevice(device);
          break;
        case "hardware":
          logger.info(
            `[DeviceManager] Hardware device "${device.name}" configured but not yet implemented`,
          );
          break;
        default:
          logger.warn(
            `[DeviceManager] Unknown device type: ${(device as any).type}`,
          );
      }
    }

    logger.info(
      `[DeviceManager] Started ${this.larkBridges.size} Lark device(s)`,
    );
  }

  /**
   * Start a single Lark device
   */
  private async startLarkDevice(config: DeviceConfig) {
    // Stop existing bridge for this device if any
    const existing = this.larkBridges.get(config.id);
    if (existing) {
      await existing.stop();
    }

    const bridge = new LarkBridge(config);
    this.larkBridges.set(config.id, bridge);

    try {
      await bridge.start();
    } catch (err) {
      logger.error(
        `[DeviceManager] Failed to start Lark device "${config.name}"`,
        err,
      );
      this.larkBridges.delete(config.id);
    }
  }

  /**
   * Stop all devices
   */
  async stopAll() {
    for (const [id, bridge] of this.larkBridges) {
      await bridge.stop();
    }
    this.larkBridges.clear();
    logger.info("[DeviceManager] All devices stopped");
  }

  /**
   * Restart all devices (called after settings change)
   */
  async restartAll() {
    await this.stopAll();
    await this.startAll();
  }
}

export const deviceManager = new DeviceManager();
