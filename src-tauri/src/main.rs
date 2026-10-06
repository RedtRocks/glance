// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The Store package's glance-mcp.exe alias starts this program (scripts/packaging.ts).
    if glance_mcp::started_as_bridge() {
        return glance_mcp::run();
    }
    glance_lib::run()
}
