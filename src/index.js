//! Default Compute@Edge template program.

/// <reference types="@fastly/js-compute" />

// The entry point for your application.
//
// Use this fetch event listener to define your main request handling logic. It could be
// used to route based on the request properties (such as method or path), send
// the request to a backend, make completely new requests, and/or generate
// synthetic responses.

const oldBackend = "old_backend";
const newBackend = "new_backend";
const webhookBackend = "webhook_backend";

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

function getConfig(dictionary, key) {
  const value = dictionary.get(key);
  if (!value) {
    throw new Error(`No value configured for ${key}`);
  }
  return value;
}

async function postToWebhook(webhookUrl, risingCloudKey, key) {
  console.log(`Posting to ${webhookUrl}`);
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

async function handleRequest(event) {
  // Get the client request.
  let req = event.request;

  // Filter requests that have unexpected methods.
  if (!["HEAD", "GET"].includes(req.method)) {
    return new Response("This method is not allowed", {
      status: 405,
    });
  }

  // Get the config
  const config = new ConfigStore("config");
  const oldOrigin = getConfig(config, "old_origin");
  const newOrigin = getConfig(config, "new_origin");
  const webhookUrl = getConfig(config, "webhook_url");
  const risingCloudKey = getConfig(config, "rising_cloud_key")

  const requestPath = new URL(req.url).pathname;

  // Try to get the object from the new backend
  let url = new URL(requestPath, newOrigin).toString();
  console.log(`Attempting to ${req.method} ${url}`);
  let response = await fetch(url, {
    backend: newBackend,
    method: req.method
  });
  console.log(`Status from new backend is ${response.status}`);

  // Is the object there?
  if (response.status === 404) {
    // Not found in the new backend - get the object from the old backend
    url = new URL(requestPath, oldOrigin).toString();
    console.log(`Attempting to ${req.method} ${url}`);
    response = await fetch(new URL(requestPath, oldOrigin).toString(), {
      backend: oldBackend,
      method: req.method
    });
    console.log(`Status from old backend is ${response.status}`);

    // Object key is the path minus the initial '/'
    const key = requestPath.substring(1);
    console.log(`Key is ${key}`);

    // Notify webhook that the object should be copied to the new backend.
    // waitUntil() will perform the fetch after the response is returned
    // to the client.
    event.waitUntil(postToWebhook(webhookUrl, risingCloudKey, key));
  }

  // Return the response to the client
  console.log(`Returning response`);
  return response;
}
