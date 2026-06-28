$(function(){

  $('.racer_list .name').each(function(index, element){

  	$('#yosen .name:contains(' + $(element).text() + ')').addClass('r'+$(this).prev('td').text());

  });

});


