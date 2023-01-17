import fetch from "node-fetch";
import * as settings from "./GlobalSetting";
import * as functions from "firebase-functions";
import * as FirebaseFcn from "./Firebase_utils";


export async function odoo_Login() {
  const response = await fetch(settings.odoo_url + "session/authenticate", settings.odoo_access);
  const data = await response.json();
  const data_headers = await response.headers.get("set-cookie");
  const session_id = data_headers?.split("=", 2)[1].split(";", 1)[0];

  if (response.status === 200) {
    try {
      functions.logger.info(response.status +" Odoo Authentication Succeeded. Session Id: " + session_id);
      functions.logger.warn( " Odoo User Expiration: " + data["result"]["expiration_date"] );
      return session_id;
    } catch (error) {
      functions.logger.error(response.status +" Odoo Authentication Failed: " + data["error"]["message"] );
    }
  } else functions.logger.error(response.status +" OdooLogin Error: unexpected " );

  return 0;
}


export async function odoo_Logout() {
  const response = await fetch(settings.odoo_url + "session/logout");
  if (response.status === 200) {
    functions.logger.info( "Odoo Logout Succeeded. ");
  } else functions.logger.error("OdooLogout Error: unexpected " + response.status);

  return response.status;
}

export async function odooToFirebase_CRM_Campaigns(odoo_session:any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "utm.campaign",
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };


  const response = await fetch(settings.odoo_url + "dataset/search_read", params);
  const data = await response.json();

  if (response.status == 200) {
    try {
      functions.logger.info( "[OdooToFirebase_CRM] Odoo request Succeeded. "+data["result"]["length"] + " records");


      const map = new Map();
      let id : any;
      let name : string;


      for (let i = 0, len = data["result"]["records"].length; i < len; i++) {
        id = data["result"]["records"][i]["id"];
        name = data["result"]["records"][i]["name"];

        map.set(id, name);
      }

      const firebase_json = Object.fromEntries(map);
      const res = await FirebaseFcn.firebaseSet("campaign_names", firebase_json);

      if (res) {
        functions.logger.info("[OdooToFirebase_CRM]  Campaings : Firebase successfully updated");
        return true;
      } else {
        functions.logger.error("[OdooToFirebase_CRM]  Campaings : Firebase updated failure");
      }
    } catch (error) {
      try {
        functions.logger.error( "[OdooToFirebase_CRM] Code:" +data["error"]["code"] + ": "+ data["error"]["message"]);
      } catch {
        functions.logger.error( "[OdooToFirebase_CRM] ERROR: ", error);
      }
    }
  } else functions.logger.error("[OdooToFirebase_CRM] Odoo request Error: unexpected " + response.status);

  return null;
}



//LOOK for HomeFragment L.157 
//Have to delete that part
export async function odooToFirebase_CRM_Tickets(odoo_session:any) {
//First have to check the timestamp. we will leave it theere as backup in case something works as fuck
const fb_timestamp = await FirebaseFcn.firebaseGet("/timestamp_collection/CMR_tickets_timestamp");
const date = new Date(Number(fb_timestamp));
const data_str = date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2);

const CustomHeaders: HeadersInit = {
  "Content-Type": "application/json",
  "Cookie": "session_id="+odoo_session,
};

const raw = JSON.stringify({
  "params": {
    "model": "crm.lead",
    "offset": 0,
    "fields": ["partner_id","campaign_id","stage_id","medium_id",
     "source_id","referred", "name","phone","mobile","tag_ids", "create_uid", "create_date", "write_date"]
    },
    "domain": ["write_date",">", data_str]
}

);

const params = {
  headers: CustomHeaders,
  method: "post",
  body: raw,
};

console.log(params);

const response = await fetch(settings.odoo_url + "dataset/search_read", params);
const data = await response.json();


console.log("data: " + JSON.stringify(data));
console.log(data_str);




return null;

}