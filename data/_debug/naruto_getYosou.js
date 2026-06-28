//////////////////////////////////////////////////////////////////
/// 初期設定
//////////////////////////////////////////////////////////////////
$nowRaceData = $('.yosou_area .js-tab_race_menu .tab_race_list .tab_race_item .selected');
//対象日付
var selectTargetDay = $nowRaceData.attr('data-day');
//選択されたレース番号
var selectTargetRace= $nowRaceData.attr('data-race');
//選択されたタブ名
var selectTargetReq = $nowRaceData.attr('data-req');
//選択されたコンテンツ番号
var selectTargetRun = $nowRaceData.attr('data-run');
//再読み込み後 30秒間のwait
var setTime = false;
//スワイプガイドを一度でも出現させたかの確認フラグ
var flgConfirmSwipeGuide = false;


//////////////////////////////////////////////////////////////////
/// レース番号の切り替えタブを押された時の処理
//////////////////////////////////////////////////////////////////
$(document).on("click", '.js-tab_race_menu .tab_race:not(.selected)', function(ev){
	let _this = $(this);

	//選択されたレース番号
	selectTargetRace = _this.attr("data-race");
	//選択されたコンテンツ番号
	selectTargetDay = _this.attr("data-day");
	//選択されたタブ名
	selectTargetReq = _this.attr("data-req");
	//選択されたコンテンツ番号
	selectTargetRun = _this.attr("data-run");
	
	//コンテンツ切替メニューに選択されたレース番号の設定
	$('.js-tab_category_list .tab_category a').attr('data-race', selectTargetRace);

	//ボタンselectedレイアウトの切り替え
	$(".js-tab_race_menu .tab_race_item .tab_race.selected").removeClass("selected");
	_this.addClass("selected");
	
	funcReadData();
	resetTimeout();
});


//////////////////////////////////////////////////////////////////
/// 出走表の早見リンクを押された時の処理
//////////////////////////////////////////////////////////////////
$(document).on("click", '.col_hayami', function(ev){
	let _this = $(this);
	let race_select_el = $(".js-tab_race_menu .tab_race_item .tab_race.selected");
	//選択されたレース番号 
	selectTargetRace= _this.attr("data-race");
	//対象日付
	selectTargetDay = race_select_el.attr("data-day");
	//選択されたタブ名
	selectTargetReq = race_select_el.attr("data-req");
	//選択されたコンテンツ番号
	selectTargetRun = race_select_el.attr("data-run");

	//コンテンツ切替メニューに選択されたレース番号の設定
	$('.js-tab_category_list .tab_category a').attr('data-race', selectTargetRace);

	//レースタブメニューの選択レイアウトの切り替え
	$(".js-tab_race_menu .tab_race_item .tab_race.selected").removeClass("selected");
	const sections = document.querySelectorAll('.js-tab_race_menu .tab_race');
	let linkedVal;
	for (const section of sections) {
		linkedVal = section.dataset.race;
		if (linkedVal === _this.attr("data-race")) {
			section.classList.add('selected');
		}
		}	
	funcReadData();
	
});


//////////////////////////////////////////////////////////////////
/// 結果一覧のレース番号リンクを押された時の処理
//////////////////////////////////////////////////////////////////
$(document).on("click", '.js-to_result', function(ev){
	let _this = $(this);
	let race_select_el = $(".js-tab_race_menu .tab_race_item .tab_race.selected");
	//選択されたレース番号 
	selectTargetRace= _this.attr("data-race");
	//選択したいタブ名
	selectTargetReq = _this.attr("data-req");
	//選択したいコンテンツ番号
	selectTargetRun = _this.attr("data-run");
	//対象日付
	selectTargetDay = race_select_el.attr("data-day");

	//コンテンツ切替メニューに選択されたレース番号の設定
	$('.js-tab_category_list .tab_category a').attr('data-race', selectTargetRace);

	//タブメニューにコンテンツ番号のリセット
	$('.js-tab_race_menu .tab_race').attr('data-run', selectTargetRun);
	//レースタブメニューにカテゴリ名のリセット
	$('.js-tab_race_menu .tab_race').attr('data-req', selectTargetReq);

	//レースタブメニューの選択レイアウトの切り替え
	$(".js-tab_race_menu .tab_race_item .tab_race.selected").removeClass("selected");
	const sections = document.querySelectorAll('.js-tab_race_menu .tab_race');
	let linkedVal;
	for (const section of sections) {
		linkedVal = section.dataset.race;
		if (linkedVal === _this.attr("data-race")) {
			section.classList.add('selected');
		}
		}

	//コンテンツ切替タブの選択レイアウトの切り替え
	$(".js-tab_category_list li.tab_category.selected").removeClass("selected");
	$(".js-tab_category_list li.tab_category a[data-req='"+selectTargetReq+"']").parent().addClass("selected");

	funcReadData();
	
});


//////////////////////////////////////////////////////////////////
/// コンテンツ切替タブを押された時の処理
//////////////////////////////////////////////////////////////////
$(document).on("click", '.js-tab_category_list .tab_category:not(.selected)', function(ev){
	let _this = $(this);
	selectTargetDay = _this.find("a").attr("data-day");
	//選択されたタブ名
	selectTargetRace = _this.find("a").attr("data-race");
	//選択されたタブ名
	selectTargetReq = _this.find("a").attr("data-req");
	//選択されたコンテンツ番号
	selectTargetRun = 0;

	//タブメニューにコンテンツ番号のリセット
	$('.js-tab_race_menu .tab_race').attr('data-run', selectTargetRun);
	//レースタブメニューにカテゴリ名のリセット
	$('.js-tab_race_menu .tab_race').attr('data-req', selectTargetReq);
	
	//コンテンツ切替タブの選択レイアウトの切り替え
	$(".js-tab_category_list li.tab_category.selected").removeClass("selected");
	_this.addClass("selected");
	
	funcReadData();
	resetTimeout();
});


//////////////////////////////////////////////////////////////////
/// オッズコンテンツ内の更新ボタンを押された時の処理
//////////////////////////////////////////////////////////////////
$(document).on('click', '.js-odds_update', function(){
	if( setTime===false ){

		//選択されたコンテンツ番号
		selectTargetRun = $('.js-tab_race_menu .tab_race.selected').attr("data-run");

		funcReadData();

		$("#js-ajaxYosouTable").attr('odds-reload-state', 'disabled');
		setTime = setTimeout(function(){
			resetTimeout();
		},30000);//30秒wait
	}
});


//////////////////////////////////////////////////////////////////
/// データの再読み込み(更新機能)
//////////////////////////////////////////////////////////////////
function funcReadData(){
	getYosou(selectTargetDay, selectTargetRace, selectTargetReq, selectTargetRun);
}


//////////////////////////////////////////////////////////////////
/// 更新ボタン押下状態の解除
//////////////////////////////////////////////////////////////////
function resetTimeout(){
	setTime = false;
	$("#js-ajaxYosouTable").removeAttr('odds-reload-state');
}


//////////////////////////////////////////////////////////////////
/// コンテンツ（出走表、直前情報、等）の取得
//////////////////////////////////////////////////////////////////
function getYosou( setDay, setRace, setReq, setRun ){
	var insertTable = $("#js-ajaxYosouTable");		
	$.ajax({
		type: "GET",
		url: "./ajax/ajax_yosou.php?targetday="+setDay+"&race="+setRace+"&req="+setReq+"&run="+setRun
		,success: function(data){
			insertTable.find(".syussouContainer").remove();
			if($(".syussouContainer").length>0){
				$(".syussouContainer").html(data);
			} else {
				insertTable.html(data);
			}
			insertTable.animate({"opacity":1},500);

			if( !flgConfirmSwipeGuide && typeof(dispSwipeGuide)=='function'){
				//ページ読み込み時、一度でもスワイプガイドの確認が出てきたら、再度読み込みするまで表示しない
				//非開催時は swipe-guide.js が読み込まれないため、関数が存在しない
				dispSwipeGuide();
			}
		}
		,error: function(data){
			console.log("error");
		}
	});
}
