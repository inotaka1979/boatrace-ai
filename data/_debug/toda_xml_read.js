
// =========================================
// XML,TMPLファイル取得用共通
// =========================================

//XML,TMPLファイル取得用共通
function download(target, option, done, fail) {
    $.ajax(target +  "?rand=" + Math.random(), option=='xml'?{type: 'get', dataType: 'xml'}:{type: 'get', dataType: 'html', scriptCharset: 'UTF-8'})
    .done(done)
    .fail(fail);
}

//0パディング関連
function zero2(num) {
  return ( '00' + num ).slice( -2 );
}


//期間算出
function calculation_period(fdate,tdate){
  //YYYYMMDD形式の日付差分を求める
  const day_ms = 86400000;
  var d_fdate = fdate.match(/.{2}/g);
  var d_tdate = tdate.match(/.{2}/g);
  d_fdate = d_fdate[0] + d_fdate[1] + "/" + d_fdate[2] + "/" + d_fdate[3];
  d_tdate = d_tdate[0] + d_tdate[1] + "/" + d_tdate[2] + "/" + d_tdate[3];
  d_fdate = new Date(d_fdate);
  d_tdate = new Date(d_tdate);
  var period = ((d_tdate - d_fdate) / day_ms) + 1;
  
  return Number(period);
  
}

//指定日のN日後の日付取得
function calculation_date(date,val){
  //YYYYMMDD形式の日付を基準としたN日後の日付を求める
  var d_date = date.match(/.{2}/g);
  d_date = d_date[0] + d_date[1] + "/" + d_date[2] + "/" + d_date[3];
  d_date = new Date(d_date);
  
  d_date.setDate((d_date.getDate() + val));
  var d_dateY = d_date.getFullYear();
  var d_dateD = d_date.getDate();
  d_date.setDate(1);
  var d_dateM = d_date.getMonth() + 1;
  
  var cal_date = String(d_dateY) + String(zero2(d_dateM)) + String(zero2(d_dateD));
  
  return cal_date;
}
