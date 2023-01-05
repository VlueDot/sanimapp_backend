import fetch from 'node-fetch'
import * as settings from './GlobalSetting'

export async function OdooLogin(){ 
    const response = await fetch(settings.odoo_url + "session/authenticate", settings.odoo_access);
    const data = await response.json()
    if(response.status === 200)
        {
            try {
                return ["OK" , "Odoo Authentication Succeeded. Expiration: " + data['result']['expiration_date'] ]
            } catch (error) {
                return  ["ERROR" ,  data['error']['message'] ]
            }
    } else return ["ERROR", response.status]
         
}

export async function OdooLogout(){ 
    const response = await fetch(settings.odoo_url + "session/logout");
    return response.status;
            
    }

 
