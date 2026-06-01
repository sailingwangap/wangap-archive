var e=typeof process<`u`&&{}?.PUBLIC_BASE_URL||`https://www.wangap.fr`,t={fr:{readInBrowser:`Lire dans le navigateur ↗`,masthead:`Journal de Bord — Catherine & Bertrand`,routeEyebrow:`Notre route`,liveMap:`voir la carte en direct ↗`,crewEyebrow:`Équipage`,signoffPrefix:`Avec nos amitiés salées,`,signoffNames:`Catherine & Bertrand`,subscribedReason:`Vous recevez cette newsletter parce que vous êtes abonné·e à Wang'ap.`,linkRead:`Lire en ligne`,linkUnsubscribe:`Se désabonner`,readInEnglish:`Read in English ↓`,readInFrench:`Lire en français ↑`,enAnchor:`Version anglaise`,frAnchor:`Version française`},en:{readInBrowser:`Read in browser ↗`,masthead:`Logbook — Catherine & Bertrand`,routeEyebrow:`Our route`,liveMap:`see the live map ↗`,crewEyebrow:`Crew`,signoffPrefix:`With salty regards,`,signoffNames:`Catherine & Bertrand`,subscribedReason:`You're receiving this newsletter because you subscribed to Wang'ap.`,linkRead:`Read online`,linkUnsubscribe:`Unsubscribe`,readInEnglish:`Read in English ↓`,readInFrench:`Read in French ↑`,enAnchor:`English version`,frAnchor:`French version`}};function n(e,n){return t[e===`en`?`en`:`fr`][n]}function r(t){return`${e}/api/newsletter?action=unsubscribe&token=${encodeURIComponent(t)}`}function i(t,n){let i=t.preheader||``,o=r(n.unsubscribe_token);return`<div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; padding: 24px 20px; color: #3D405B; line-height: 1.6;">
  <span style="display:none;font-size:1px;color:transparent;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${a(i)}</span>
  <div style="text-align: center; margin-bottom: 24px;">
    <h1 style="font-family: Georgia, serif; color: #1B9AAA; font-size: 22px; margin: 0;">wang'ap</h1>
    <p style="color: #8D99AE; font-size: 11px; margin: 4px 0 0;">Journal de Bord — Catherine &amp; Bertrand</p>
  </div>
  <div style="font-size: 15px;">
    ${t.body_html}
  </div>
  <p style="margin-top: 32px; font-size: 11px; color: #8D99AE; text-align: center; border-top: 1px solid rgba(141,153,174,0.2); padding-top: 16px;">
    Vous recevez cette newsletter parce que vous êtes abonné·e à Wang'ap.<br>
    <a href="${o}" style="color: #1B9AAA;">Se désabonner</a>
    · <a href="${e}" style="color: #1B9AAA;">wang'ap.fr</a>
  </p>
</div>`}function a(e){return String(e||``).replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}var o={titre:{type:`text`,label:{fr:`Titre suggéré`,en:`Suggested subject`},placeholder:{fr:`ex. "Premier mois en Atlantique"`,en:`e.g. "First month in the Atlantic"`}},theme:{type:`text`,label:{fr:`Thème éditorial`,en:`Editorial angle`},placeholder:{fr:`angle, fil narratif…`,en:`angle, narrative thread…`}},ton:{type:`enum`,label:{fr:`Ton`,en:`Tone`},options:[`poétique`,`sobre`,`familier`,`technique`],default:`sobre`},style:{type:`enum`,label:{fr:`Style narratif`,en:`Narrative style`},options:[`récit chronologique`,`lettre à des amis`,`résumé thématique`],default:`lettre à des amis`},longueur:{type:`enum`,label:{fr:`Longueur`,en:`Length`},options:[`court (~400 mots)`,`moyen (~800 mots)`,`long (~1500 mots)`],default:`moyen (~800 mots)`},audience:{type:`enum`,label:{fr:`Audience prioritaire`,en:`Primary audience`},options:[`famille proche`,`cercle élargi`,`contacts maritimes`],default:`cercle élargi`}};function s(o,s,c={}){let m=o.sections||null;if(!m)return i(o,s);let g=c.lang||`fr`,_=c.imageBaseUrl||e,v=r(s?.unsubscribe_token||`preview`),y=`${e}/newsletters/${o.id}`,b=u(m,`subtitle`,g===`en`?`en`:`fr`)||m.subtitle||``,x;if(g===`both`&&l(m))x=[h({viewOnlineUrl:y,lang:`fr`,imageBaseUrl:_}),f(`#${t.en.enAnchor.replace(/\s/g,`-`)}`,n(`fr`,`readInEnglish`),`fr`),d(m,`fr`),p(`en`),d(m,`en`),S({unsubUrl:v,viewOnlineUrl:y,lang:`fr`})].filter(Boolean).join(`
`);else{let e=g===`en`&&l(m)?`en`:`fr`;x=[h({viewOnlineUrl:y,lang:e,imageBaseUrl:_}),d(m,e),S({unsubUrl:v,viewOnlineUrl:y,lang:e})].filter(Boolean).join(`
`)}let C=x;return`<div style="background: #FDF8F0; padding: 24px 12px;">
  <div style="font-family: Lora, Georgia, serif; max-width: 640px; margin: 0 auto; padding: 0; background: #FFFEF9; border-radius: 14px; color: #3D405B; line-height: 1.6; box-shadow: 0 1px 3px rgba(0,0,0,0.04); overflow: hidden;">
    <div style="background: linear-gradient(90deg, #1B9AAA 0%, #FFD166 50%, #EF476F 100%); height: 3px; opacity: 0.85;"></div>
    <div style="padding: 8px 28px 32px;">
      <span style="display:none;font-size:1px;color:transparent;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${a(b)}</span>
      ${C}
    </div>
  </div>
</div>`}var c=[`title`,`photos`,`map`,`metrics`,`text`,`crew`];function l(e){return!!(e.title_en&&e.title_en.trim()||e.text_en&&e.text_en.trim()||e.subtitle_en&&e.subtitle_en.trim())}function u(e,t,n){if(n===`en`){let n=`${t}_en`;if(typeof e[n]==`string`&&e[n].trim())return e[n]}return e[t]}function d(e,t){let n={title:u(e,`title`,t),subtitle:u(e,`subtitle`,t),text:u(e,`text`,t)};return(Array.isArray(e.order)&&e.order.length>0?e.order:c).map(r=>{switch(r){case`title`:return g(n,t);case`photos`:return _(e.photos);case`map`:return v(e.map,t);case`metrics`:return y(e.metrics);case`text`:return b(n.text);case`crew`:return x(e.crew,t);default:return null}}).filter(Boolean).join(`
`)}function f(e,t){return`<p style="text-align: center; margin: 8px 0 0;">
    <a href="${e}" style="font-family: Lora, Georgia, serif; font-size: 11px; font-style: italic; color: #1B9AAA; text-decoration: none; letter-spacing: 0.3px;">${a(t)}</a>
  </p>`}function p(e){let n=t[e].enAnchor.replace(/\s/g,`-`),r=e===`en`?`#top`:`#${t.fr.frAnchor.replace(/\s/g,`-`)}`;return`<div id="${n}" style="margin: 36px 0; border-top: 2px dashed rgba(141,153,174,0.3); padding-top: 24px;">
    <p style="text-align: center; font-family: Lora, Georgia, serif; font-size: 11px; font-style: italic; letter-spacing: 0.5px; text-transform: uppercase; color: #8D99AE; margin: 0 0 6px;">${a(e===`en`?t.en.enAnchor:t.fr.frAnchor)}</p>
    <p style="text-align: center; margin: 0;"><a href="${r}" style="font-family: Lora, Georgia, serif; font-size: 10px; color: #1B9AAA; text-decoration: none;">${a(t[e===`en`?`fr`:`en`].readInFrench)}</a></p>
  </div>`}function m(e,t={}){let n=e?.sections||null;return n?`<div style="font-family: Lora, Georgia, serif; max-width: 640px; margin: 0 auto; padding: 8px 28px 32px; color: #3D405B; line-height: 1.6;">
${d(n,t.lang===`en`&&l(n)?`en`:`fr`)}
</div>`:``}function h({viewOnlineUrl:t,lang:r=`fr`,imageBaseUrl:i=e}){let o=`${i}/wangap-archive/images/logo.png`;return`<div style="text-align: center; padding: 20px 0 16px;">
    <p style="margin: 0 0 14px; font-size: 10px; letter-spacing: 0.5px; text-transform: uppercase; color: #8D99AE;">
      <a href="${t}" style="color: #1B9AAA; text-decoration: none;">${a(n(r,`readInBrowser`))}</a>
    </p>
    <img src="${o}" alt="" width="86" height="75" style="display:block;margin:0 auto 6px;width:86px;height:auto;border:0;" />
    <h1 style="font-family: Lora, Georgia, serif; color: #1B9AAA; font-size: 28px; margin: 0; letter-spacing: -0.5px; line-height: 1.1;">wang&rsquo;ap</h1>
    <p style="color: #8D99AE; font-size: 11px; font-style: italic; margin: 4px 0 0;">${a(n(r,`masthead`))}</p>
    <hr style="border: 0; border-top: 1px solid rgba(141,153,174,0.18); margin: 18px auto 0; max-width: 80px;"/>
  </div>`}function g(e,t=`fr`){return!e.title&&!e.subtitle?null:`<div style="text-align: center; margin: 8px 0 28px;">
    ${e.title?`<h2 style="font-family: Georgia, serif; color: #3D405B; font-size: 26px; line-height: 1.25; margin: 0; font-weight: 700; letter-spacing: -0.2px;">${a(e.title)}</h2>`:``}
    ${e.subtitle?`<p style="font-family: Georgia, serif; color: #5C6479; font-size: 15px; font-style: italic; line-height: 1.5; margin: 10px 24px 0;">${a(e.subtitle)}</p>`:``}
    <div style="width: 36px; height: 2px; background: #1B9AAA; margin: 18px auto 0; border-radius: 2px;"></div>
  </div>`}function _(e){if(!Array.isArray(e)||e.length===0)return null;let t=e.filter(e=>e?.url).slice(0,6);if(t.length===0)return null;let n=`display:block;width:100%;height:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.5);`,r=`${n}max-height:420px;object-fit:cover;`,i=(e,t)=>`<td style="padding: 3px;" width="${t}"><img src="${C(e.url)}" alt="${C(e.alt||``)}" style="${n}"></td>`,a=e=>`<tr><td colspan="2" style="padding: 3px;"><img src="${C(e.url)}" alt="${C(e.alt||``)}" style="${r}"></td></tr>`,o=e=>`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 28px; border-collapse: separate;">${e}</table>`;if(t.length===1)return o(a(t[0]));if(t.length===2)return o(`<tr>${i(t[0],`50%`)}${i(t[1],`50%`)}</tr>`);if(t.length===3)return o(`${a(t[0])}<tr>${i(t[1],`50%`)}${i(t[2],`50%`)}</tr>`);if(t.length===4)return o(`<tr>${i(t[0],`50%`)}${i(t[1],`50%`)}</tr><tr>${i(t[2],`50%`)}${i(t[3],`50%`)}</tr>`);let s=[a(t[0]),`<tr>${i(t[1],`50%`)}${i(t[2],`50%`)}</tr>`];return t.length>=5&&s.push(`<tr>${i(t[3],`50%`)}${i(t[4],`50%`)}</tr>`),t.length>=6&&s.push(`<tr><td colspan="2" style="padding: 3px;"><img src="${C(t[5].url)}" alt="${C(t[5].alt||``)}" style="${n}"></td></tr>`),o(s.join(``))}function v(t,r=`fr`){if(!t?.png_url||t._hidden)return null;let i=r===`en`?T:w,o=t.from_date&&t.to_date?`${i(t.from_date)} → ${i(t.to_date)}`:``,s=t.first_port||t.last_port?`${a(t.first_port||``)}${t.last_port&&t.last_port!==t.first_port?` → ${a(t.last_port)}`:``}`:``,c=`${e}/?asVisitor=1#carte`;return`<div style="margin: 0 0 28px;">
    <p style="text-align: center; font-family: Lora, Georgia, serif; font-size: 11px; font-style: italic; letter-spacing: 0.5px; text-transform: uppercase; color: #8D99AE; margin: 0 0 10px;">${a(n(r,`routeEyebrow`))}</p>
    <a href="${c}" style="display:block;text-decoration:none;">
      <img src="${C(t.png_url)}" alt="${C(n(r,`routeEyebrow`))}" style="display:block;width:100%;height:auto;border-radius:10px;border:1px solid rgba(141,153,174,0.18);">
    </a>
    ${s||o?`<p style="text-align:center; font-family: Lora, Georgia, serif; font-size: 13px; color: #3D405B; margin: 10px 0 4px;"><strong>${s||``}</strong>${s&&o?`<br>`:``}<span style="color: #8D99AE; font-style: italic;">${o}</span></p>`:``}
    <p style="text-align:center; font-size: 10px; margin: 6px 0 0;"><a href="${c}" style="color: #1B9AAA; text-decoration: none;">${a(n(r,`liveMap`))}</a></p>
  </div>`}function y(e){if(!Array.isArray(e)||e.length===0)return null;let t=e.filter(e=>e&&e.included!==!1&&e.value!=null&&e.value!==``);if(t.length===0)return null;let n=Math.min(t.length,3),r=[];for(let e=0;e<t.length;e+=n){let i=t.slice(e,e+n).map((e,t)=>`
      <td style="padding: 18px 12px; text-align: center; vertical-align: top; ${t>0?`border-left: 1px solid rgba(141,153,174,0.15);`:``}" width="${Math.floor(100/n)}%">
        <div style="font-family: Georgia, serif; font-size: 26px; color: #1B9AAA; font-weight: 700; line-height: 1.05; letter-spacing: -0.5px;">${a(String(e.value))}</div>
        <div style="font-size: 10px; color: #8D99AE; margin-top: 6px; letter-spacing: 0.4px; text-transform: uppercase;">${a(e.label)}</div>
      </td>`).join(``);r.push(`<tr>${i}</tr>`)}return`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 28px; background: rgba(27,154,170,0.05); border-radius: 12px; border: 1px solid rgba(27,154,170,0.10);">
    ${r.join(``)}
  </table>`}function b(e){return!e||typeof e!=`string`||!e.trim()?null:`<div style="font-family: Georgia, serif; font-size: 16px; line-height: 1.7; color: #3D405B; margin: 0 0 28px;">${e}</div>`}function x(e,t=`fr`){if(!Array.isArray(e)||e.length===0)return null;let r=e.filter(e=>e&&e.included!==!1);if(r.length===0)return null;let i=r.map(e=>`<tr>
      <td style="padding: 8px 0; vertical-align: middle; width: 40px;">
        <div style="width: 32px; height: 32px; border-radius: 50%; background: rgba(27,154,170,0.18); color: #1B9AAA; font-family: Georgia, serif; font-size: 14px; font-weight: 700; line-height: 32px; text-align: center;">${a((e.first_name||`?`).trim().charAt(0).toUpperCase())}</div>
      </td>
      <td style="padding: 8px 0 8px 10px; vertical-align: middle;">
        <div style="font-family: Georgia, serif; font-size: 14px; font-weight: 700; color: #3D405B; line-height: 1.2;">${a(e.first_name||``)}</div>
        <div style="font-size: 11px; color: #8D99AE; margin-top: 2px;">
          ${e.etape?`<span>${a(e.etape)}</span>`:``}${e.etape&&e.dates?` · `:``}${e.dates?`<span style="font-style: italic;">${a(e.dates)}</span>`:``}
        </div>
      </td>
    </tr>`).join(``);return`<div style="margin: 0 0 28px; padding: 20px 22px; background: rgba(255,209,102,0.10); border-radius: 12px; border: 1px solid rgba(255,209,102,0.25);">
    <p style="margin: 0 0 8px; font-family: Lora, Georgia, serif; font-size: 11px; font-style: italic; letter-spacing: 0.5px; text-transform: uppercase; color: #8D99AE; text-align: center;">${a(n(t,`crewEyebrow`))}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">${i}</table>
  </div>`}function S({unsubUrl:t,viewOnlineUrl:r,lang:i=`fr`}){return`<div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid rgba(141,153,174,0.18); text-align: center;">
    <p style="font-family: Lora, Georgia, serif; font-size: 12px; font-style: italic; color: #5C6479; margin: 0 0 14px;">
      ${a(n(i,`signoffPrefix`))}<br><strong style="font-style: normal;">${a(n(i,`signoffNames`))}</strong>
    </p>
    <p style="font-size: 10px; color: #8D99AE; margin: 0; line-height: 1.6;">
      ${a(n(i,`subscribedReason`))}<br>
      <a href="${r}" style="color: #1B9AAA; text-decoration: none;">${a(n(i,`linkRead`))}</a>
      &nbsp;|&nbsp;
      <a href="${t}" style="color: #1B9AAA; text-decoration: none;">${a(n(i,`linkUnsubscribe`))}</a>
      &nbsp;|&nbsp;
      <a href="${e}" style="color: #1B9AAA; text-decoration: none;">wang'ap.fr</a>
    </p>
  </div>`}function C(e){return String(e||``).replace(/&/g,`&amp;`).replace(/"/g,`&quot;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`)}function w(e){if(!e)return``;try{return new Date(e).toLocaleDateString(`fr-FR`,{day:`numeric`,month:`short`,year:`numeric`})}catch{return String(e)}}function T(e){if(!e)return``;try{return new Date(e).toLocaleDateString(`en-GB`,{day:`numeric`,month:`short`,year:`numeric`})}catch{return String(e)}}export{m as i,c as n,s as r,o as t};