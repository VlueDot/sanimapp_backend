import fetch from 'node-fetch'
import * as settings from './GlobalSetting'
import * as functions from "firebase-functions";


export async function  OdooLogin(){ 
    const response = await fetch(settings.odoo_url + "session/authenticate", settings.odoo_access);
    const data = await response.json()
    if(response.status === 200)
        {
            try {
                functions.logger.info(response.status +" Odoo Authentication Succeeded. User Expiration: " + data['result']['expiration_date'] )
                return 1
            } catch (error) {
                functions.logger.error(response.status +" Odoo Authentication Failed: " + data['error']['message'] )
            }
    } else functions.logger.error(response.status +" OdooLogin Error: unexpected " )

    return 0
         
}

export async function OdooLogout(){ 
    const response = await fetch(settings.odoo_url + "session/logout");
    if(response.status === 200){
        functions.logger.info( "Odoo Logout Succeeded. ")
    } else functions.logger.error("OdooLogout Error: unexpected " + response.status)

    return response.status;
            
    }




 
