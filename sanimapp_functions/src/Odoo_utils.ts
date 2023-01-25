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

let CRM_tickets_not_archived = await FirebaseFcn.firebaseGet("/CRM_tickets_not_archived")
const CRM_tickets_not_archived_dataAsKeys = new Map()
for(let key in CRM_tickets_not_archived) {
  CRM_tickets_not_archived_dataAsKeys.set(CRM_tickets_not_archived[key], key)
}


//get potencialUserIds from firebase
const notRegisteredUsers = await FirebaseFcn.firebaseGet("/notRegisteredUsers");
// console.log("notRegisteredUsers", notRegisteredUsers)
let potencialUserId :any = []
for(let ids in notRegisteredUsers) potencialUserId.push(ids)
// console.log("potencialUserIds", potencialUserId)

//get user registered ids
let typesVentas = [
  "Cliente Potencial", "Cliente con firma",
  "Cliente ganado", "Cliente con Venta perdida"]
const RegisteredUsers = await FirebaseFcn.firebaseGet("/Data_client");
// console.log("RegisteredUsers", RegisteredUsers)
let RegisteredUsersId :any = []
for(let ids in RegisteredUsers) {
  if (typesVentas.includes(RegisteredUsers[ids]["Data_client_3"]["client_type"])) RegisteredUsersId.push(ids)
}



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
            "2022-06-06 21:50:37"
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

// console.log(params);

const response = await fetch(settings.odoo_url + "dataset/search_read", params);
const data = await response.json();
// console.log("data: " + JSON.stringify(data));
const data_len = data["result"]["length"];
const records = data["result"]["records"];





for(var i = 0; i < data_len ; i++){
  let id = String(records[i]["id"]);
  var stage_id = records[i]["stage_id"][0];
  let partner_id="NaN"    //why Nan ? 
 
  var medium_id="NaN"
  var source_id="NaN"
  var estateCRM="Cliente Nuevo"
  var typeService="Otro"

 

  try {
      let campaign_id=records[i]["campaign_id"][1];
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
    
      for (var j = 0; j < tag_ids.length; j++){

        if(tag_ids[j] == "2") typeService = "Ventas-Pamplona"
        else if(tag_ids[j] == "3") typeService = "Ventas-Accu"
        else typeService = "Otro"
        
        
         
      }

      if (partner_id ==null || campaign_id ==null || medium_id ==null || source_id ==null  ) {
     
        let changed = ""
        if (campaign_id==null) {campaign_id = "NaN"; changed += "campaign_id "}
        if (partner_id==null) {partner_id = "NaN"; changed += "partner_id " }
        if (medium_id==null) {medium_id = "NaN"; changed += "medium_id " }
        if (source_id==null) {source_id = "NaN" ; changed += "source_id "}
        functions.logger.warn("Nulls found. " , {"Function" : "odooToFirebase_CRM_Tickets", "Id" : id , "Changing nulls" : changed  });
      
      }

      if(partner_id ==null || campaign_id ==null || medium_id ==null || source_id ==null || referred ==null || name ==null || create_uid ==null || tag_ids ==null || create_date==null || estateCRM==null || typeService==null ) {
        functions.logger.error("ERROR: Nulls found beside correction.", {"Function:": "odooToFirebase_CRM_Tickets", "record": records[i]});
      } 
      
      //VerifyAndUpdateCMRTicket OdooUserX.kt line 1403
      //have to check a match between odoo and firebase. line 1413

      // in firebase does exist id from odoo?
      

      
      if(potencialUserId.includes(id)){
      
        // if (id == "2808") {
        //   console.log("notRegisteredUsers", notRegisteredUsers["2808"])
          // console.log("record Odoo", records[i])

        // }
        let data : any = []
        data = notRegisteredUsers[id]
        
        
        data["Campaign_month"] = campaign_id
        
        data["How_know_us"] = medium_id
        data["How_know_us_method"] = source_id
        data["How_know_us_referals"] = referred
        data["Name_potencial"] = name
        data["Phone1"] = phone
        data["Phone2"] = mobile
        data["Sales_person"] = create_uid
        data["Zone"] = typeService
      
        
        if(estateCRM == "Cliente Potencial"){
          console.log("Case 1 " + id)
          FirebaseFcn.firebaseSet("/notRegisteredUsers/"+id + "/", data);
        }
        else{
          
          if(partner_id == "NaN" ){
            console.log("Case 2 " + id)
            data["Client_Type"] = estateCRM
            FirebaseFcn.firebaseSet("/notRegisteredUsers/"+id + "/", data);
            
            
          }
          else{

            FirebaseFcn.firebaseRemove("/notRegisteredUsers/"+ id)
            
            if(RegisteredUsersId.includes(partner_id)){ 
              console.log("Case 3 " + id)
              
              FirebaseFcn.firebaseSet("/Data_client/" + CRM_tickets_not_archived_dataAsKeys.get(id)+"Data_client_2/Client_Type/", estateCRM)
              FirebaseFcn.firebaseSet("/Data_client/" + CRM_tickets_not_archived_dataAsKeys.get(id)+"Data_client_3/client_type/", estateCRM)
            
            
            }
            else{
              console.log("Case 4 "+ id)
              //Read user and write it to firebase
              //ok use data but not phone 1, phone2 

              
              
              FirebaseFcn.firebaseSet("/CRM_tickets_not_archived/"+partner_id + "/", id)                
              ReadContactsAndUpdate(odoo_session, partner_id,data,estateCRM) 

            }
          }
          

        }
      }
      else{
        //line 1484

        


      }
      
     
      
      
  }
  catch (error){
    functions.logger.error( "ERROR: " + error, {"Function":"odooToFirebase_CRM_Tickets", "Record": records[i]});}
  }

  





return null;

}



async function ReadContactsAndUpdate( odoo_session:any,partner_id:any,  dataCRM : any, stateCRM : any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };
  
  const raw = JSON.stringify({
    "params": {
      "model": "res.partner",
      "fields": [
          "id",
          "phone",
          "mobile",
          "comment",
          "surname",
          "mother_name",
          "first_name",
          "middle_name",
          "vat",
          "contact_address",
          "country_id",
          "l10n_pe_ubigeo",
          "display_name",
          "category_id"

      ],
      "offset": 0,
      "domain": [
          [
              "id",
              "=",
              partner_id
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


  

  try{
    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);
    const data = await response.json();
    const data_len = Number( data["result"]["length"]);
    if(data_len>1) {functions.logger.error( "ERROR: " + "Data length must be 1.", {"Function":"ReadContactsAndUpdate", "Partner id: ": partner_id}); }
    const records = data["result"]["records"];
    let id = records["id"]
    try {
      let phone = String(records["phone"])
      let mobile = String(records["mobile"])
      let comment = String(records["comment"])
      let surname = String(records["surname"])
      let mother_name = String(records["mother_name"])
      let first_name = String(records["first_name"])
      let middle_name = String(records["middle_name"])
      let vat = String(records["vat"])
      let contact_address = String(records["contact_address"])
      let country_id = String(records["country_id"])
      let l10n_pe_ubigeo = String(records["l10_pe_ubigeo"])
      let display_name = String(records["display_name"])

      if (phone=="false"){
        phone="NaN"
    }
    if (comment=="false"){
        comment="NaN"
    }
    if (mobile=="false"){
        mobile="NaN"
    }

    let userData1 = dataCRM

    userData1["Sales_person_Commit"]="NaN"
    userData1["Client_Community"]="NaN"
    userData1["Name_1"]=first_name
    userData1["Name_2"]= middle_name
    userData1["Last_name_1"]=surname
    userData1["Last_name_2"]=mother_name
    userData1["Addr_reference"]="NaN"
    userData1["Address"]= contact_address
    userData1["Birth_date"]="NaN"
    userData1["Country"]= country_id
    userData1["DNI"]=vat
    userData1["Lost_client_reason"]="NaN"
    userData1["Phone1"]=phone
    userData1["Phone2"]=mobile
    userData1["Urine_preference"]="NaN"
    userData1["ubigeo"]=l10n_pe_ubigeo

    let userData2= {

      "Route":"NaN",
      "Stops":"NaN",
      "Client_Type":stateCRM,
      "Lat":0,
      "Long":0,

    }
    let userData3= {
      "Name_complete":display_name,
      "Addr":contact_address,
      "Addr_reference":"NaN",
      "client_coment_OPE":"NaN",
      "Phone1":phone,
      "Phone2":mobile,
      "client_type":stateCRM

    }
    FirebaseFcn.firebaseSet("/Data_client/Data_client_1/",userData1)
    FirebaseFcn.firebaseSet("/Data_client/Data_client_2/",userData2)
    FirebaseFcn.firebaseSet("/Data_client/Data_client_3/",userData3)
    functions.logger.info("User "  + id + " has been registered successfully")
      
    }
    catch (err) {functions.logger.error(
      functions.logger.error( "ERROR: " + "Some Variable wasnt readed. " + err, {"Function":"ReadContactsAndUpdate", "Partner id: ": partner_id})
    )}


  }
  catch(err) {
    functions.logger.error( "ERROR: " + err, {"Function":"ReadContactsAndUpdate", "Partner id: ": partner_id});}
  
    
}