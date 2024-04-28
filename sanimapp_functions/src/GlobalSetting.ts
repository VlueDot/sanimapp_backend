
const dev = "oxe360-ooc-sanisol-150-staging-15-0-12768682";
// https://oxe360-ooc-sanisol-150-staging-15-0-10504135.dev.odoo.com/
const prod = "oxe360-ooc-sanisol-150-prd-15-0-8745362";

export const ALL_SECRETS =
["Odoo_BackendAccessMail", "Odoo_BackendAccessMail_password",
  "Vluedot_LogMail", "Vluedot_LogMail_password",
  "credential_projectId", "credential_privateKey", "credential_clientEmail",
];

export const odoo_db = get_odoo_db();
export const odoo_url = get_odoo_url();

export async function odoo_access() {
  return {
    headers: {"Content-Type": "application/json"},
    method: "post",
    body: JSON.stringify(

        {
          "params": {
            "db": odoo_db,
            "login": process.env.Odoo_BackendAccessMail,
            "password": process.env.Odoo_BackendAccessMail_password,

          }}),
  };
}

export async function odoo_access2(params:any) {
  console.log(params);
  console.log(params.Odoo_BackendAccessMail);
  return {
    headers: {"Content-Type": "application/json"},
    method: "post",
    body: JSON.stringify(

        {
          "params": {
            "db": odoo_db,
            "login": params.Odoo_BackendAccessMail,
            "password": params.Odoo_BackendAccessMail_password,

          }}),
  };
}


function get_odoo_url() {
  if ( process.env.GCLOUD_PROJECT == "sanimapp-prod") {
    return "https://oxe360-ooc-sanisol-150.odoo.com/web/";
  } else if (process.env.GCLOUD_PROJECT === "sanimappdev") {
    return "https://"+ odoo_db +".dev.odoo.com/web/";
  } else {
    return "https://"+ odoo_db +".dev.odoo.com/web/";
  }
}

function get_odoo_db() {
  if ( process.env.GCLOUD_PROJECT == "sanimapp-prod") {
    return prod;
  } else if (process.env.GCLOUD_PROJECT === "sanimappdev") {
    return dev;
  } else {
    return dev;
  }
}

export function get_serviceAccount() {
  if ( process.env.GCLOUD_PROJECT == "sanimapp-prod") {
    return "./service-account-prod.json";
  } else if (process.env.GCLOUD_PROJECT === "sanimappdev") {
    return "./service-account-dev.json";
  } else {
    return "./service-account-dev.json";
  }
}

export function get_urldatabase() {
  if ( process.env.GCLOUD_PROJECT == "sanimapp-prod") {
    return "https://sanimapp-prod-default-rtdb.firebaseio.com";
  } else if (process.env.GCLOUD_PROJECT === "sanimappdev") {
    return "https://sanimappdev-default-rtdb.firebaseio.com";
  } else {
    return "https://sanimappdev-default-rtdb.firebaseio.com";
  }
}


// const {SecretManagerServiceClient} = require("@google-cloud/secret-manager");
// const secretClient = new SecretManagerServiceClient();

// export async function getSecret(secret: string) {
//   // console.log(process.env.GCLOUD_PROJECT);
//   const name = "projects/"+process.env.GCLOUD_PROJECT+"/secrets/"+secret+"/versions/latest";
//   const [accessResponse] = await secretClient.accessSecretVersion({name});
//   return accessResponse.payload["data"].toString("utf8");
// }
