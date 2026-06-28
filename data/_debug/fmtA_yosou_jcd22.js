$(function(){

	var mover = $(".js-move");

	function slidersPropaty(){
		this.startX = 0;
		this.startY = 0;
		this.moveXRange = 0;
		this.slideResult= 1;

		this.setStartX 	= function( setNum ){
			//touchstart 座標Xを変数にセット
			this.startX = setNum;
		}
		this.getStartX 	= function(){
			return this.startX;
		}
		
		this.setStartY 	= function( setNum ){
			//touchstart 座標Yを変数にセット
			this.startY = setNum;
		}
		this.getStartY 	= function(){
			return this.startY;
		}
		
		this.setSlideResult = function( setNum ){
			//item動かし後の結果をセット
			//0:右へスワイプ
			//1:スワイプなし
			//2:左へスワイプ
			this.slideResult = setNum;
		}
		this.getSlideResult 	= function(){
			return this.slideResult;
		}
	}
	
	function afterproc( result ){
		var first = $(".js-mover li:first");
		var last  = $(".js-mover li:last");
		mover.addClass("moving");
		
		switch(result){
			case 0:
				last.prependTo(mover);
				mover.removeAttr("style");
				break;
			case 1:
				break;
			
			case 2:
				first.appendTo(mover);
				mover.removeAttr("style");
				break;
		}
		
	}
	
	function moveitem(range){
		mover.css({
			 "transform":"translate3d("+range+"px, 0, 0)"
			,"-webkit-transform":"translate3d("+range+"px, 0, 0)"
			,"-moz-transform":"translate3d("+range+"px, 0, 0)"
		});
	}

	
	//******************************************
	//	矢印ボタンのスライド(左右)
	//******************************************
	$(".js-slide-btn").on("click", function(e){
	
		if(!mover.hasClass("on")){
			mover.addClass("on");
		
			var range;
			if( $(this).hasClass("left") ){
				range = $(window).width();
				spropaty.setSlideResult(0); 
			}else{
				range = -$(window).width();
				spropaty.setSlideResult(2); 
			}
			mover.removeClass("moving not-move");
			moveitem( range );
			mover.removeClass("on");

		}
	});
	
	
	
	
	
	
	
	
	
	//最初の定義
	var js_move = $(".js-move");
	var moveX, sX, sY, moveCurrent;
	var pageLastNum = window.pageLastNum;
	
	//機能別に作成
	// (1) 各ページにリンク
	$(".js-link").on("click",function(){
		var url = $(this).data("url");
		if( url ){
			window.location.href = url;
		}
	});
	
	// (2) 次のページを表示
	$(".js-itemselect.is_select").on("click",function(){
		moveCurrent = 2;
		js_move.removeClass("moving").css({
		 "transform":"translate3d(" + -$(window).width() + "px, 0, 0)"
		,"-webkit-transform":"translate3d(" + -$(window).width() + "px, 0, 0)"
		,"-moz-transform":"translate3d(" + -$(window).width() + "px, 0, 0)"
		});
		// window.itemselectMove(moveCurrent, window.pageLastNum);
	});
	
	
	window.itemselectMove = function( moveCurrent, pageLastNum ){
		//*************************************
		// 出走表等のカテゴリー部分
		//*************************************
		var itemselect = $(".js-itemselect.is_select");
		var currentItemNum = itemselect.data("page");	//現在ページ番号
		
		if(moveCurrent != 1){
			//1以外
			switch(moveCurrent){
					
				case 0:
					var nextItemNum = (currentItemNum == 0)? pageLastNum: currentItemNum-1;
					break;
					
				case 2:
					var nextItemNum = (currentItemNum == pageLastNum)? 0: currentItemNum+1;
					break;
			}
					
			$( ".category_item.page_"+currentItemNum ).removeClass("is_current");
			$( ".category_item.page_"+nextItemNum ).addClass("is_current");
				
			itemselect.data("page", nextItemNum);
		}
	}
	
	
	
	window.unitMove = function( moveCurrent, pageLastNum ){
		//*************************************
		// ページスライド
		//*************************************
		var js_move = $(".js-move");
		js_move.addClass("moving");
		
		js_move.css({
		 "transform":"translate3d(0, 0, 0)"
		,"-webkit-transform":"translate3d(0, 0, 0)"
		,"-moz-transform":"translate3d(0, 0, 0)"
		});

		var currentUnitNum 	= $(".js-unit").eq(1).data("unitnum");
		
		switch( moveCurrent ){
			case 0:		//左表示(右へスワイプ)
				var preUnitNum 		= $(".js-unit").eq(0).data("unitnum");
				var newUnitNum = ( preUnitNum == 0 )? pageLastNum: preUnitNum-1;
				var newUnit = '<div class="js-unit" data-unitnum="'+newUnitNum+'">'+pageArr[newUnitNum]+'</div>';
				$(".js-unit").eq(2).remove();
				js_move.prepend(newUnit).removeAttr("style");
				break;
				
			case 1:		//変わらず
				break;
				
			case 2:		//右表示(左へスワイプ)
				var nextUnitNum 	= $(".js-unit").eq(2).data("unitnum");
				var newUnitNum = ( nextUnitNum == pageLastNum )? 0: nextUnitNum+1;
				var newUnit = '<div class="js-unit" data-unitnum="'+newUnitNum+'">'+pageArr[newUnitNum]+'</div>';
				$(".js-unit").eq(0).remove();
				js_move.append(newUnit).removeAttr("style");
				break;
		}
		
	}
	
	

	//スライドfunction
	$(".js-move").on("touchstart", ".js-unit", function(Tevent){

		// Tevent.preventDefault();
		js_move.removeClass("moving");
		js_move.addClass("cls_ts");

	
		moveX = 0;
		sX = 0;
		sY = 0;

		//※タッチ座標割り出し
		Tevent = Tevent.originalEvent.changedTouches[0];
		sX = Tevent.pageX;
		sY = Tevent.pageY;
		
		js_move.removeClass("cls_ts");


	}).on("touchmove", ".js-unit", function(e){
	
		e.preventDefault();

		var mX = sX;
		var mY = sY;
		
		mX = e.originalEvent.changedTouches[0].pageX;
		mY = e.originalEvent.changedTouches[0].pageY;
		var htmldom = $("html body");
		var cTop = htmldom.scrollTop();
		
		
		switch(true){
			case ( js_move.hasClass("moving") ):
					//※横のみ動く
					e.preventDefault();
					moveX = (mX - sX);
					
					js_move.css({
					 "transform":"translate3d(" + moveX + "px, 0, 0)"
					,"-webkit-transform":"translate3d(" + moveX + "px, 0, 0)"
					,"-moz-transform":"translate3d(" + moveX + "px, 0, 0)"
					});
				break;
				
			case ( js_move.hasClass("moveY") ):
					//※縦のみ動く
					htmldom.scrollTop( cTop + (sY-mY) );
				break;
				
			default:
				//※どの方向に動くかのチェックをして
				//※更に縦にも動く
				var moveJudge_y = mY - sY;
				if( Math.abs(moveJudge_y) >15){
					js_move.addClass("moveY");
					// sX = mX;//新スタート位置
				}else{
			
					var moveJudge_x = mX - sX;
					if( Math.abs(moveJudge_x) >10){
						js_move.addClass("moving");
						sX = mX;//新スタート位置
					}
				}
				// if(!js_move.hasClass("moveY")){
				// }
				
				js_move.css({
					 "transform":"translate3d(" + moveX + "px, 0, 0)"
					,"-webkit-transform":"translate3d(" + moveX + "px, 0, 0)"
					,"-moz-transform":"translate3d(" + moveX + "px, 0, 0)"
					});
				
				// htmldom.scrollTop( cTop + (sY-mY) );
		}

	}).on("touchend", ".js-unit", function(Mevent){
	
		js_move.removeClass("moving moveY");

		
		js_move.addClass("cls_te");
		
		//リンク付きの時の処理
		var _href = Mevent.target.href;
		
		var endY = Mevent.originalEvent.changedTouches[0].pageY;
		
		
		Mevent.preventDefault();
		
		//※最終的にどのくらい動かしたかの分岐
		var movePoint = 0;
			moveCurrent = 1;
		if(Math.abs(moveX) > 30){
			//※30以上動かした場合、指を離した時は左右のどちらかに 100% 動く
			movePoint = (moveX > 0)? $(window).width(): -$(window).width();
			moveCurrent = (moveX > 0)?　0: 2;
		}else if(Math.abs(moveX) < 10 && Math.abs(endY-sY) <= 10 && typeof( _href ) != "undefined"){
			
			if( $(Mevent.target).attr("target") == "_blank" ){
				window.open( _href, "_blank" );
			}else{
				window.location.href = _href;
			}
			
		}
		
		
		/*************************************************************/
		//絶対に px指定 とする。
		//標準ブラウザは、transitionに %パーセンテージ指定が効かない。
		//%指定にしてしまうとtransition中、要素が消えてしまう。
		/*************************************************************/
		js_move.css({
			 "transform":"translate3d("+movePoint+"px, 0, 0)"
			,"-webkit-transform":"translate3d("+movePoint+"px, 0, 0)"
			,"-moz-transform":"translate3d("+movePoint+"px, 0, 0)"
		});
		
		
	});
	
	
	js_move.on("transitionend webkitTransitionEnd",function(e){

			if(moveCurrent != undefined){
				e.preventDefault();


				
				window.unitMove( moveCurrent, window.pageLastNum);
				window.itemselectMove( moveCurrent, window.pageLastNum );
				
				//runを変更していく
				$.each($(".e-link option"), function(i,v){
					var getUrl = $(this).val();
					$(this).attr("value" , getUrl.replace(/run=\d+/ , "run=" + $(".js-unit").eq(1).data("unitnum") ));
				});
			}
	});
	
});