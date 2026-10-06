//! Speech to text for the Ask AI sidebar's mic, with Windows speech recognition (the same
//! dictation as Win+H). Words arrive as `speech` events: `partial` while a phrase is being
//! spoken, `final` when it is finished, `error` when something stops it, then `end`.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SpeechEvent {
    Partial { text: String },
    Final { text: String },
    End,
    /// `code`: "privacy" (Online speech recognition is off), "no-mic", "language" or "other".
    Error { code: String, message: String },
}

fn emit(app: &AppHandle, e: SpeechEvent) {
    let _ = app.emit("speech", e);
}

/// What the user can do about a failure, from its HRESULT.
#[cfg_attr(not(windows), allow(dead_code))]
fn code_for(hresult: i32) -> &'static str {
    match hresult as u32 {
        // SPERR_SPEECH_PRIVACY_POLICY_NOT_ACCEPTED
        0x8004_5509 => "privacy",
        // E_ACCESSDENIED (microphone blocked), no audio device
        0x8007_0005 | 0x8004_5508 | 0x8004_5507 => "no-mic",
        _ => "other",
    }
}

/// Starts listening in `language` (a BCP 47 tag; empty for Windows' speech language).
#[tauri::command]
pub async fn speech_start(app: AppHandle, language: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || win::start(app, &language)).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, language);
        Err("Speech recognition is only available on Windows.".into())
    }
}

/// Stops listening; an `end` event follows.
#[tauri::command]
pub async fn speech_stop(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || win::stop(&app)).await.map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = app;
    Ok(())
}

#[cfg(windows)]
mod win {
    use super::{code_for, emit, SpeechEvent};
    use std::sync::Mutex;
    use tauri::AppHandle;
    use windows::core::{Interface, HSTRING};
    use windows::Foundation::{TimeSpan, TypedEventHandler};
    use windows::Globalization::Language;
    use windows::Media::SpeechRecognition::*;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    /// The recognizer that is listening, if any.
    static ACTIVE: Mutex<Option<SpeechRecognizer>> = Mutex::new(None);

    fn error(app: &AppHandle, e: &windows::core::Error) {
        emit(app, SpeechEvent::Error { code: code_for(e.code().0).into(), message: e.message() });
    }

    pub fn start(app: AppHandle, language: &str) -> Result<(), String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        stop(&app);
        let run = || -> windows::core::Result<Result<SpeechRecognizer, (String, String)>> {
            let recognizer = if language.is_empty() {
                SpeechRecognizer::new()?
            } else {
                SpeechRecognizer::Create(&Language::CreateLanguage(&HSTRING::from(language))?)?
            };
            let dictation = SpeechRecognitionTopicConstraint::Create(SpeechRecognitionScenario::Dictation, &HSTRING::from("dictation"))?;
            recognizer.Constraints()?.Append(&dictation.cast::<ISpeechRecognitionConstraint>()?)?;
            let compiled = recognizer.CompileConstraintsAsync()?.join()?;
            match compiled.Status()? {
                SpeechRecognitionResultStatus::Success => {}
                SpeechRecognitionResultStatus::TopicLanguageNotSupported | SpeechRecognitionResultStatus::GrammarLanguageMismatch => {
                    return Ok(Err(("language".into(), "speech recognition isn’t installed for this language".into())));
                }
                SpeechRecognitionResultStatus::MicrophoneUnavailable => return Ok(Err(("no-mic".into(), "no microphone".into()))),
                s => return Ok(Err(("other".into(), format!("speech recognition couldn’t start ({})", s.0)))),
            }
            // Keep listening through pauses; the sidebar decides when a pause means "send".
            let session = recognizer.ContinuousRecognitionSession()?;
            session.SetAutoStopSilenceTimeout(TimeSpan { Duration: 10 * 60 * 10_000_000 })?;
            let a = app.clone();
            recognizer.HypothesisGenerated(&TypedEventHandler::<SpeechRecognizer, SpeechRecognitionHypothesisGeneratedEventArgs>::new(move |_, args| {
                if let Some(args) = args.as_ref() {
                    emit(&a, SpeechEvent::Partial { text: args.Hypothesis()?.Text()?.to_string() });
                }
                Ok(())
            }))?;
            let a = app.clone();
            session.ResultGenerated(&TypedEventHandler::<SpeechContinuousRecognitionSession, SpeechContinuousRecognitionResultGeneratedEventArgs>::new(move |_, args| {
                if let Some(args) = args.as_ref() {
                    let result = args.Result()?;
                    if result.Status()? == SpeechRecognitionResultStatus::Success && result.Confidence()? != SpeechRecognitionConfidence::Rejected {
                        emit(&a, SpeechEvent::Final { text: result.Text()?.to_string() });
                    }
                }
                Ok(())
            }))?;
            let a = app.clone();
            session.Completed(&TypedEventHandler::<SpeechContinuousRecognitionSession, SpeechContinuousRecognitionCompletedEventArgs>::new(move |_, args| {
                if let Some(args) = args.as_ref() {
                    match args.Status()? {
                        SpeechRecognitionResultStatus::Success | SpeechRecognitionResultStatus::UserCanceled | SpeechRecognitionResultStatus::TimeoutExceeded => {}
                        SpeechRecognitionResultStatus::MicrophoneUnavailable => emit(&a, SpeechEvent::Error { code: "no-mic".into(), message: "the microphone went away".into() }),
                        SpeechRecognitionResultStatus::NetworkFailure => emit(&a, SpeechEvent::Error { code: "other".into(), message: "no internet connection".into() }),
                        s => emit(&a, SpeechEvent::Error { code: "other".into(), message: format!("recognition stopped ({})", s.0) }),
                    }
                }
                ACTIVE.lock().unwrap().take();
                emit(&a, SpeechEvent::End);
                Ok(())
            }))?;
            session.StartAsync()?.join()?;
            Ok(Ok(recognizer))
        };
        match run() {
            Ok(Ok(recognizer)) => {
                *ACTIVE.lock().unwrap() = Some(recognizer);
                Ok(())
            }
            Ok(Err((code, message))) => Err(format!("{code}: {message}")),
            Err(e) => {
                let code = code_for(e.code().0);
                Err(format!("{code}: {}", e.message()))
            }
        }
    }

    pub fn stop(app: &AppHandle) {
        let Some(recognizer) = ACTIVE.lock().unwrap().take() else { return };
        // Completed fires and sends `end`; if stopping fails, say it ended anyway.
        let stopped = recognizer.ContinuousRecognitionSession().and_then(|s| s.StopAsync()).and_then(|op| op.join());
        if let Err(e) = stopped {
            error(app, &e);
            emit(app, SpeechEvent::End);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_match_the_webview() {
        let json = |e: SpeechEvent| serde_json::to_string(&e).unwrap();
        assert_eq!(json(SpeechEvent::Partial { text: "hi".into() }), r#"{"kind":"partial","text":"hi"}"#);
        assert_eq!(json(SpeechEvent::End), r#"{"kind":"end"}"#);
        assert_eq!(json(SpeechEvent::Error { code: "no-mic".into(), message: "x".into() }), r#"{"kind":"error","code":"no-mic","message":"x"}"#);
    }

    #[test]
    fn failures_say_what_to_fix() {
        assert_eq!(code_for(0x8004_5509u32 as i32), "privacy");
        assert_eq!(code_for(0x8007_0005u32 as i32), "no-mic");
        assert_eq!(code_for(0x8000_4005u32 as i32), "other");
    }
}
