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
// const fb_timestamp = await FirebaseFcn.firebaseGet("/timestamp_collection/CMR_tickets_timestamp");
// const date = new Date(Number(fb_timestamp));
// const data_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";

const CustomHeaders: HeadersInit = {
  "Content-Type": "application/json",
  "Cookie": "session_id="+odoo_session,
};

const raw = JSON.stringify({
  "params": {
    "model": "crm.lead",
    "fields": [
        "partner_id",
        "campaign_id",
        "stage_id",
        "medium_id",
        "source_id",
        "referred",
        "name",
        "phone",
        "mobile",
        "tag_ids",
        "create_uid",
        "create_date"
    ],
    "offset": 0,
    "domain": [
        [
            "write_date",
            ">",
            "2022-11-06 21:50:37"
        ]
    ]
  }
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
const data_len = data["result"]["length"];
const records = data["result"]["records"];



for(var i = 0; i < data_len ; i++){
  var stage_id = records[i]["stage_id"][0];
  var partner_id="NaN"    //why Nan ? 
  var campaign_id="NaN"
  var medium_id="NaN"
  var source_id="NaN"
  var estateCRM="Cliente Nuevo"
  // var typeService="Otro"


  try {
      campaign_id=records[i]["campaign_id"][1];
      if (stage_id!=1) partner_id = records[i]["partner_id"][0];
      medium_id=records[i]["medium_id"][1];
      source_id=records[i]["source_id"][1];
      let referred=records[i]["referred"];
      let name=records[i]["name"];

      let phone=records[i]["phone"];
      if (phone=="false"){
          phone="NaN"
      }

      let mobile=records[i]["mobile"];
      if (mobile=="false"){
          mobile="NaN"
      }

      let create_uid=records[i]["create_uid"][1];
      let tag_ids=records[i]["tag_ids"];
      let create_date=records[i]["create_date"];

      switch (stage_id) {
        case 1:
          estateCRM = "Cliente Potencial" 
          break;
        case 2:
          estateCRM = "Cliente con firma" 
        case 3: 
          estateCRM = "Cliente ganado"
        case 4: 
          estateCRM = "Cliente con Venta perdida"     
        default:
          estateCRM = "NaN"
          break;
      }
    
      var tag_ids_map = []
      for (var i = 0; i < tag_ids.length; i++){
        tag_ids_map.push (tag_ids[i])

      }

      console.log("tag_ids map" +tag_ids_map)
      

      console.log({partner_id, campaign_id,medium_id,source_id, referred, name, create_uid, tag_ids, create_date, estateCRM});
  }
  catch (error){
    functions.logger.error( "[odooToFirebase_CRM_Tickets] ERROR: ", error);}
  }

  

  console.log("stage_id", stage_id);

 





return null;

}