//////////////////////////////////////////////////////////////////
/// コンテンツ高さを変更
//////////////////////////////////////////////////////////////////
function contentHeightChange(){
	let $slideUnit = $(".js-unit.slick-current");
	var contentHeight = '';
	if( $slideUnit.find('img').length>0 ){
		$slideUnit.find('img').on('load', function(){	
			contentHeight = $(".js-unit.slick-current").height();	
			$('.js-slide').css('height', contentHeight+'px');
		});
		contentHeight = $(".js-unit.slick-current").height();	
		$('.js-slide').css('height', contentHeight+'px');
	}else{
		contentHeight = $(".js-unit.slick-current").height();	
		$('.js-slide').css('height', contentHeight+'px');
	}
}
