use serde::Serialize;
use tauri_plugin_shell::ShellExt;

/// An error returned to the UI. `code` is a sidecar exit code
/// (app/util/exitCodes.ts); `message` is shown to the user.
#[derive(Serialize)]
pub struct SidecarError {
    code: i32,
    message: String,
}

/// EXIT.ACTION_REFUSED in app/util/exitCodes.ts.
const ACTION_REFUSED: i32 = 7;

/// Runs `lcu-sidecar <args>`. The sidecar owns the command list; this check
/// only keeps the arguments to plain words and ids.
#[tauri::command]
async fn rewards(app: tauri::AppHandle, args: Vec<String>) -> Result<String, SidecarError> {
    let plain = args
        .iter()
        .all(|a| a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    if args.is_empty() || !plain {
        return Err(SidecarError {
            code: ACTION_REFUSED,
            message: "command not allowed".into(),
        });
    }
    run_sidecar(&app, args).await
}

/// Logs and errors arrive on stderr; on a non-zero exit the stderr text is
/// returned as the error message.
async fn run_sidecar(app: &tauri::AppHandle, args: Vec<String>) -> Result<String, SidecarError> {
    let unavailable = |e: String| SidecarError { code: -1, message: e };
    let output = app
        .shell()
        .sidecar("lcu-sidecar")
        .map_err(|e| unavailable(format!("sidecar not available: {e}")))?
        .args(args)
        .output()
        .await
        .map_err(|e| unavailable(format!("could not run the sidecar: {e}")))?;

    if output.status.success() {
        // Reuse the stdout buffer (it can be over 1 MB) instead of copying it.
        Ok(String::from_utf8(output.stdout)
            .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned()))
    } else {
        Err(SidecarError {
            code: output.status.code().unwrap_or(-1),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![rewards])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
