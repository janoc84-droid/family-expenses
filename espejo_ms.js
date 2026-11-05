/* Modo espejo desde el telefono: leer espejo.json directo del OneDrive del usuario, entrando con su cuenta Microsoft
   (05-11-2026). OAuth 2.0 con PKCE (sin contraseñas ni secretos en esta pagina publica): Microsoft pide la cuenta y
   devuelve un permiso de SOLO LECTURA de archivos (Files.Read) que queda guardado en este navegador.

   ESPEJO_MS_CLIENT_ID = el "Id. de aplicacion (cliente)" de la aplicacion registrada en Microsoft Entra
   (portal.azure.com -> Registros de aplicaciones). No es secreto: identifica a esta pagina ante Microsoft. Mientras
   este vacio, la entrada con Microsoft no aparece y la web lee la carpeta de OneDrive del computador (espejo.js). */
(function(){
  "use strict";

  var ESPEJO_MS_CLIENT_ID = "";
  var AUTORIDAD = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
  var PERMISOS = "Files.Read offline_access";
  var RUTA_ESPEJO = "FamilyExpensesSync/espejo.json";
  var CLAVE_TOKEN = "gf_ms_token", CLAVE_PKCE = "gf_ms_pkce";

  function redireccion(){ return location.origin + location.pathname; }

  function b64url(bytes){
    var s = "";
    bytes = new Uint8Array(bytes);
    for(var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function azar(n){ var a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }

  function guardarToken(t){
    var datos = {acceso: t.access_token, refresco: t.refresh_token || null,
                 vence: Date.now() + (Number(t.expires_in) || 3600) * 1000 - 60000};
    try{ localStorage.setItem(CLAVE_TOKEN, JSON.stringify(datos)); }catch(e){}
    return datos;
  }
  function tokenGuardado(){
    try{ return JSON.parse(localStorage.getItem(CLAVE_TOKEN) || "null"); }catch(e){ return null; }
  }
  function pedirToken(cuerpo){
    cuerpo.client_id = ESPEJO_MS_CLIENT_ID;
    return fetch(AUTORIDAD + "/token", {
      method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams(cuerpo).toString()
    }).then(function(r){ return r.json().then(function(j){
      if(!r.ok) throw new Error(j.error_description || j.error || ("HTTP " + r.status));
      return guardarToken(j);
    }); });
  }

  // vuelta desde Microsoft (?code=...): se cambia el codigo por el permiso y se limpia la direccion
  function procesarVuelta(){
    var q = new URLSearchParams(location.search);
    if(!q.get("code") && !q.get("error")) return Promise.resolve(null);
    var pkce = null;
    try{ pkce = JSON.parse(sessionStorage.getItem(CLAVE_PKCE) || "null"); sessionStorage.removeItem(CLAVE_PKCE); }catch(e){}
    history.replaceState(null, "", redireccion());
    if(q.get("error")) return Promise.reject(new Error(q.get("error_description") || q.get("error")));
    if(!pkce || pkce.estado !== q.get("state")) return Promise.reject(new Error("respuesta de Microsoft inesperada"));
    return pedirToken({grant_type: "authorization_code", code: q.get("code"), redirect_uri: redireccion(),
                       code_verifier: pkce.verificador, scope: PERMISOS});
  }

  function irAEntrar(){
    var verificador = azar(48), estado = azar(16);
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador)).then(function(h){
      try{ sessionStorage.setItem(CLAVE_PKCE, JSON.stringify({verificador: verificador, estado: estado})); }catch(e){}
      location.href = AUTORIDAD + "/authorize?" + new URLSearchParams({
        client_id: ESPEJO_MS_CLIENT_ID, response_type: "code", redirect_uri: redireccion(), scope: PERMISOS,
        state: estado, code_challenge: b64url(h), code_challenge_method: "S256", prompt: "select_account"
      }).toString();
      return new Promise(function(){});      // la pagina se va a Microsoft
    });
  }

  function token(interactivo){
    return procesarVuelta().then(function(nuevo){
      if(nuevo) return nuevo;
      var t = tokenGuardado();
      if(t && t.acceso && t.vence > Date.now()) return t;
      if(t && t.refresco){
        return pedirToken({grant_type: "refresh_token", refresh_token: t.refresco, scope: PERMISOS})
          .catch(function(){ return null; });
      }
      return null;
    }).then(function(t){
      if(t) return t;
      return interactivo ? irAEntrar() : null;
    });
  }

  function leer(interactivo){
    if(!ESPEJO_MS_CLIENT_ID) return Promise.resolve(null);
    return token(interactivo).then(function(t){
      if(!t) return null;
      return fetch("https://graph.microsoft.com/v1.0/me/drive/root:/" + RUTA_ESPEJO + ":/content",
                   {headers: {Authorization: "Bearer " + t.acceso}}).then(function(r){
        if(r.status === 401){ try{ localStorage.removeItem(CLAVE_TOKEN); }catch(e){} return interactivo ? irAEntrar() : null; }
        if(r.status === 404) throw new Error("No encontré FamilyExpensesSync/espejo.json en tu OneDrive (¿el escritorio ya se cerró una vez con esta versión?).");
        if(!r.ok) throw new Error("OneDrive respondió " + r.status);
        return r.json();
      });
    });
  }

  window.GFEspejoMicrosoft = {
    disponible: function(){ return !!ESPEJO_MS_CLIENT_ID; },
    leer: leer,
    salir: function(){ try{ localStorage.removeItem(CLAVE_TOKEN); }catch(e){} }
  };
})();
