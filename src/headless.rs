use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Error;
use headless_chrome::protocol::cdp::Page;
use headless_chrome::{Browser, LaunchOptions, Tab};
use tracing::{info, warn};

use crate::jobs::{get_job_result, trigger_test};

// best layout for mcp studio is fullhd
const BROWSER_WIDTH: u32 = 1920;
const BROWSER_HEIGHT: u32 = 1080;

// Waiting to load the mcp profile
const INITIAL_TIMEOUT: Duration = Duration::from_secs(10);

pub fn open_headless_tab() -> Result<(Browser, Arc<Tab>), Error> {
    let browser = Browser::new(LaunchOptions {
        window_size: Some((BROWSER_WIDTH, BROWSER_HEIGHT)),
        ..Default::default()
    })?;
    let tab = browser.new_tab()?;

    tab.navigate_to(crate::PUBLIC_URL)?;

    // Waiting to load the mcp profile
    std::thread::sleep(INITIAL_TIMEOUT);

    Ok((browser, tab))
}

// This use to capture headless screenshot for debugging
#[allow(dead_code)]
pub fn capture_headless(path: &Path, tab: &Arc<Tab>) -> Result<(), Error> {
    let jpeg_data =
        tab.capture_screenshot(Page::CaptureScreenshotFormatOption::Jpeg, None, None, true)?;
    std::fs::write(path, jpeg_data)?;
    Ok(())
}

// Basically, we don't need to headless tab due to we control via websocket
pub async fn run_headless_tests(test_ids: Vec<String>) -> Result<(), Error> {
    // _browser must stay alive for the entire run — dropping it kills Chrome
    let (_browser, tab) = open_headless_tab()?;

    for test_id in test_ids {
        info!("Test {test_id}: triggering");

        let job_id = match trigger_test(test_id.clone()).await {
            Ok(res) => {
                info!("Test {test_id}: triggered, job_id={}", res.job_id);
                res.job_id
            }
            Err(reason) => {
                warn!("Test {test_id}: failed to trigger: {reason}");
                continue;
            }
        };

        tokio::time::sleep(Duration::from_secs(30)).await;

        let screenshot_path = format!("{test_id}_result.jpeg");
        if let Ok(jpeg) =
            tab.capture_screenshot(Page::CaptureScreenshotFormatOption::Jpeg, None, None, true)
        {
            let _ = std::fs::write(&screenshot_path, jpeg);
            info!("Test {test_id}: screenshot saved to {screenshot_path}");
        }

        match get_job_result(&job_id).await {
            Some(result) => info!("Test {test_id}: result: {}", result),
            None => warn!("Test {test_id}: no result found for job_id={job_id}"),
        }

        info!("Test {test_id}: done");
    }

    Ok(())
}
