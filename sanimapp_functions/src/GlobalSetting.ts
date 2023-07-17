
const dev = "oxe360-ooc-sanisol-150-staging-15-0-8879677";
const prod = "oxe360-ooc-sanisol-150-prd-15-0-8745362";
export const odoo_db = get_odoo_db();
export const odoo_url = get_odoo_url();

export const odoo_access = {
  headers: {"Content-Type": "application/json"},
  method: "post",
  body: JSON.stringify(

      {
        "params": {
          "db": odoo_db,
          "login": "pablo@sanima.pe",
          "password": "Sanima2021",
        }})};


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
