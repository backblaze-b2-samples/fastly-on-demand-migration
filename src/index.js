//! Backblaze B2 Tech Day Demo: Compute@Edge app to migrate content on demand.

/// <reference types="@fastly/js-compute" />

// These backends must be configured for the app
const oldBackend = "old_backend";
const newBackend = "new_backend";
const webhookBackend = "webhook_backend";

// Wrapper to throw an exception if a dictionary entry is not found
function getConfig(dictionary, key) {
  const value = dictionary.get(key);
  if (!value) {
    throw new Error(`No value configured for ${key}`);
  }
  return value;
}

// Post an object key to the webhook
async function postToWebhook(webhookUrl, risingCloudKey, key) {
  console.log(`Posting ${key} to ${webhookUrl}`);
  return fetch(
      webhookUrl,
      {
        backend: webhookBackend,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RisingCloud-Auth': risingCloudKey
        },
        body: JSON.stringify({
          "key": key
        })
      }
  ).then(async resp => {
    console.log(`Status is ${resp.status}`);
    console.log('Content', await resp.text());
  }, async err => {
    console.log(`Error: ${err}`);
    throw err;
  });
}

// Wrapper for fetch to add some logging
async function getObject(url, backend, method) {
  console.log(`Attempting to ${method} ${url} from ${backend}`);
  let response = await fetch(url, {
    backend: backend,
    method: method
  });
  console.log(`Status from ${backend} is ${response.status}, cache ${response.headers.get('X-Cache')}`);
  return response;
}

async function handleRequest(event) {
  const req = event.request;

  // Filter requests that have unexpected methods.
  if (!["HEAD", "GET"].includes(req.method)) {
    return new Response("This method is not allowed", {status: 405});
  }

  // Ignore noise from favicon requests
  if (req.url.endsWith('/favicon.ico')) {
    return new Response(null,  { status: 404 });
  }

  // Get the config
  const config = new ConfigStore("config");
  const webhookUrl = getConfig(config, "webhook_url");
  const risingCloudKey = getConfig(config, "rising_cloud_key")

  const noCopy = req.headers.get('X-No-Copy');
  const requestFromTask = (noCopy && noCopy.toString() === "1");
  let response;

  if (!requestFromTask) {
    // It's not a request from the task - try to get the object from the new backend
    response = await getObject(req.url, newBackend, req.method);
  }

  if (requestFromTask || response.status === 404) {
    // The request came from the task, or the object was not found in the new backend
    // Get the object from the old backend
    response = await getObject(req.url, oldBackend, req.method);

    // If we found an object, and the request wasn't from the task, post a notification to the task
    if (response.ok && !requestFromTask) {
      // Object key is the path minus the initial '/'
      const requestPath = new URL(req.url).pathname;
      const key = requestPath.substring(1);

      // Notify webhook that the object should be copied to the new backend.
      // waitUntil() will perform the fetch after the response is returned
      // to the client.
      event.waitUntil(postToWebhook(webhookUrl, risingCloudKey, key));
    }
  }

  // Return the response to the client
  console.log(`Returning response`);
  return response;
}

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));