

  export const odoo_url : string = 'https://oxe360-ooc-sanisol-staging-13-0-6571046.dev.odoo.com/web/session/authenticate';
    export const odoo_access = {
      headers: { 'Content-Type': 'application/json' },
      method: 'post',
      body: JSON.stringify(
        
        {
        
          "params":{
              "db": "oxe360-ooc-sanisol-staging-13-0-6571046",
              "login":"pablo@sanima.pe",
              "password" : "Sanima2021"
              }})}
