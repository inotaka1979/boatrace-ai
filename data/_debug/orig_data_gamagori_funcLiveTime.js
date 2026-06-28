function funcJsSmartAgentGetter()
{
    var strReturn            // 戻り値
    var strUserAgent        // USERAGENT

    // Agent取得
    strUserAgent = navigator.userAgent;

    // Agent判別処理
    if( strUserAgent.indexOf("Linux; U; Android") != -1 )
    {// Androidの時
        strReturn = "Android";
    }
    else if( strUserAgent.indexOf("Linux; Android") != -1 )
    {//AndroidのGoogleChromeでアクセスしたとき
        strReturn = "Android";
    }
    else if( strUserAgent.indexOf("iPhone;") != -1 )
    {// iphoneの時
        strReturn = "iPhone";
    }
    else if( strUserAgent.indexOf("iPad;") != -1 )
    {// ipadの時
        strReturn = "iPad";
    }
    else if( strUserAgent.indexOf("iPod;") != -1 )
    {// ipodの時
        strReturn = "iPod";
    }
    else
    {// PC またはその他のスマートフォン
        strReturn = "PC";
    }

    // 戻り値
    return strReturn;
}

function onClickLive( ){
            
                                    
                
                top.location.href='https://www.gamagori-kyotei.com/asp/gamagori/sp/kyogi/moviehtml/movie_live.htm';
                        }
