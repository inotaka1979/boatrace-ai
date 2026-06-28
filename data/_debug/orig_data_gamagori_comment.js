//選手コメント前日取得(引数 登番
function funcBeforeComment( argTouban )
{
	var strComment = '';
	var strTouban = argTouban;
	if( strTouban === '2538'){
			strComment = 'かかりは良くなっているけど、スタートが難しい。';
	}else if( strTouban === '3406'){
			strComment = '全体的に戦えるけど、いいエンジンとは伸びで追い着かれる。';
	}else if( strTouban === '3538'){
			strComment = '足は中の下。ピット離れもあやしい。';
	}else if( strTouban === '3572'){
			strComment = '相手によっては伸びるけど、いい人と比べると分が悪い。';
	}else if( strTouban === '3613'){
			strComment = 'スリット近辺は良くなった。更なる上積みを求めてペラをやる。';
	}else if( strTouban === '3704'){
			strComment = '伸びが良くてターン回りも良くなっているけど…。';
	}else if( strTouban === '3710'){
			strComment = '回り足が上向き。伸びは良くないと思うけど…。';
	}else if( strTouban === '3852'){
			strComment = '自分の足は普通で特徴がない。';
	}else if( strTouban === '3870'){
			strComment = '伸びに寄せた調整をしたら全然ダメだった。';
	}else if( strTouban === '3871'){
			strComment = '気圧が下がってもいい感じだし、いいエンジンだと思う。';
	}else if( strTouban === '3986'){
			strComment = 'バランスが取れて中堅ど真ん中。';
	}else if( strTouban === '4043'){
			strComment = '現状は全体的に良くない。';
	}else if( strTouban === '4067'){
			strComment = 'グリップはしているけど、足が少し良くない。';
	}else if( strTouban === '4240'){
			strComment = 'ブラケットを換えて乗り心地は一番良かった。';
	}else if( strTouban === '4252'){
			strComment = 'どこがいいとかはないけど、バランスが取れていいと思う。';
	}else if( strTouban === '4389'){
			strComment = 'ペラを叩き変えて走り出せば悪くない。転覆の影響はない。';
	}else if( strTouban === '4397'){
			strComment = '完全にエンジンを壊してしまった。どの足もまずい状態。';
	}else if( strTouban === '4467'){
			strComment = 'タイムが出ているし悪くはないけど、ずっと違和感がある。';
	}else if( strTouban === '4485'){
			strComment = 'バランスが取れて良くなったし、４日目が一番だった。';
	}else if( strTouban === '4516'){
			strComment = 'ターン足を重視して調整が合った時はターン回りがいい。';
	}else if( strTouban === '4639'){
			strComment = '３日目から何もしていない。行き足から伸びがいい。';
	}else if( strTouban === '4648'){
			strComment = '出足とか回った後の押し感がいい。転覆の影響はないと思う。';
	}else if( strTouban === '4664'){
			strComment = 'まだ後半の方が戦える足だった。';
	}else if( strTouban === '4665'){
			strComment = '行き足がいい。伸びが７、出足が３の感じ。';
	}else if( strTouban === '4739'){
			strComment = '足はいいけど、今節は出足や回り足があまい。';
	}else if( strTouban === '4857'){
			strComment = '足は全体的に良くて上位だけど、乗り心地は悪い。';
	}else if( strTouban === '4953'){
			strComment = '３日目までの方が行き足から伸びは良かった。';
	}else if( strTouban === '4957'){
			strComment = '回り足は悪くないけど、足のパンチがなさ過ぎ。';
	}else if( strTouban === '5037'){
			strComment = 'ターンの出口が思ったほど進んでいなかった。中堅。';
	}else if( strTouban === '5046'){
			strComment = '試運転は良くなったかなと思ったけど、レースは全然だった。';
	}else if( strTouban === '5066'){
			strComment = '出足は悪くないけど、尾上さんとは直線が違っていた。';
	}else if( strTouban === '5105'){
			strComment = '回り足は悪くないけど、直線は少し劣勢。';
	}else if( strTouban === '5223'){
			strComment = '全体的に普通はあるし、４日目が一番良かった気がする。';
	}else if( strTouban === '5232'){
			strComment = 'ターン回りはいいと思うけど、全体の仕上がりは上がいる。';
	}else if( strTouban === '5243'){
			strComment = '最初は回り足だけだったけど、ペラをやって直線も上向き。';
	}else if( strTouban === '5245'){
			strComment = '最初は下がっていたけど、整備とペラをして普通にはなった。';
	}else if( strTouban === '5268'){
			strComment = '出足やターン回りが良くて直線は普通。';
	}else if( strTouban === '5286'){
			strComment = '４日目前半は伸び返されたけど、自分の直線も悪くなかった。';
	}else if( strTouban === '5292'){
			strComment = '伸びることはないけど、舟が返って来るし、回り足はいい。';
	}else if( strTouban === '5335'){
			strComment = '乗り心地がいいし、変わらず悪くない。';
	}else if( strTouban === '5346'){
			strComment = '伸びが弱いので部品交換を含めて考える。';
	}else if( strTouban === '5376'){
			strComment = '中村晃朋さんと直線は一緒くらいだったし、足は悪くない。';
	}else if( strTouban === '5399'){
			strComment = 'ペラを叩いて反応があった。乗りやすくなった。';
	}else if( strTouban === '5461'){
			strComment = 'チルトを０にして、こっちの方が乗りやすかった。';
	}else if( strTouban === '5472'){
			strComment = 'ペラを叩いてから少しずつ乗れるようになった。';
	}else{
	//例外
		strComment = '';
	}
	return strComment;
}
//選手コメント取得 引数 登番(当日コメント)
function funcToDayComment( argTouban )
{
	var strComment = '';
	var strTouban = argTouban;
	if( strTouban === '2538'){
		strComment = '少し重さはあったけど、乗り心地は良かった。';
	}else if( strTouban === '3406'){
		strComment = '序盤と比べると良くはなっているけど、納得はしていない。';
	}else if( strTouban === '3538'){
		strComment = '本体を組み直して４日目までよりは良くなった。';
	}else if( strTouban === '3572'){
		strComment = 'スリットからの足はいい。';
	}else if( strTouban === '3613'){
		strComment = '準優に入っても競ることが出来たし、全体的に上積みはあった。';
	}else if( strTouban === '3704'){
		strComment = '伸び寄りでいいと思うけど、自分のターンが…。';
	}else if( strTouban === '3710'){
		strComment = '回り足が良くて悪くないけど、伸びは弱い。';
	}else if( strTouban === '3852'){
		strComment = 'アドバイスをもらってターン回りが良くなっていた。';
	}else if( strTouban === '3870'){
		strComment = 'セッティングを戻して中の下。何とかしのぎたい。';
	}else if( strTouban === '3871'){
		strComment = '変わらずエンジンはいいけど、スタートが行けないことが全て。';
	}else if( strTouban === '3986'){
		strComment = '低気圧のせいか、５日目は回ってなかった。';
	}else if( strTouban === '4043'){
		strComment = '吉田一心選手とは全然違ったし、成績通りの足。';
	}else if( strTouban === '4067'){
		strComment = '大きな変化はなく足は普通。スタート勘は悪くない。';
	}else if( strTouban === '4240'){
		strComment = 'チルトを０に上げて足は良かった。乗り心地も大丈夫。';
	}else if( strTouban === '4252'){
		strComment = '出足や回り足は悪くなかったし、伸びも普通ある。';
	}else if( strTouban === '4389'){
		strComment = '伸びがいい人には分が悪いけど、出足やターン回りは悪くない。';
	}else if( strTouban === '4397'){
		strComment = 'ピストン交換で一番悪い時よりはマシになっている。';
	}else if( strTouban === '4467'){
		strComment = '違和感はなくなったけど、準優に入ると目立たなかった。';
	}else if( strTouban === '4485'){
		strComment = '４日目の方が良かったけど、ターン回りは普通になった。';
	}else if( strTouban === '4516'){
		strComment = 'しっかりグリップしていたし、出足や回り足が良くて自分好み。';
	}else if( strTouban === '4639'){
		strComment = '行き足から伸びが良くていい仕上がり。';
	}else if( strTouban === '4648'){
		strComment = '変わらず押しはいいけど、他も出して来ている。';
	}else if( strTouban === '4664'){
		strComment = '足は悪くないけど、スタートで遅れてしまった。';
	}else if( strTouban === '4665'){
		strComment = 'チルトをマイナスにしても伸びの方が良かった。';
	}else if( strTouban === '4739'){
		strComment = '足重視にこだわって伸びが９、出足が１のイメージで行きたい。';
	}else if( strTouban === '4857'){
		strComment = '足に関しては全体的にいいけど乗り心地は好きな感じではない。';
	}else if( strTouban === '4953'){
		strComment = '５日目は道中が重くて足落ちしていた。';
	}else if( strTouban === '4957'){
		strComment = '下がることはないけど、無難な感じで中堅くらい。';
	}else if( strTouban === '5037'){
		strComment = '乗り心地を求めると下がるので、足重視で行っている。';
	}else if( strTouban === '5046'){
		strComment = 'クランクシャフトを換えてみたけど、変わらなかった。';
	}else if( strTouban === '5066'){
		strComment = '準優は合ってなくて乗りづらかった。合えば出足は悪くない。';
	}else if( strTouban === '5105'){
		strComment = '４日目からターン回りが良くなっている。';
	}else if( strTouban === '5223'){
		strComment = 'ペラをやってみたけど、４日目の方が体感は良かった。';
	}else if( strTouban === '5232'){
		strComment = '準優のターン回りはスムーズだったし全体的に中の上くらい。';
	}else if( strTouban === '5243'){
		strComment = '４日目からターン回りに加えて直線も上向いている。';
	}else if( strTouban === '5245'){
		strComment = '５日目はバランスが取れて普通より良かった。';
	}else if( strTouban === '5268'){
		strComment = 'ターン系で、いい人とは伸びが違う。';
	}else if( strTouban === '5286'){
		strComment = '起こしが良くなくてスタートが気持ち良く行けていない。';
	}else if( strTouban === '5292'){
		strComment = '回り足を重視した調整で引き続きいい感じ。';
	}else if( strTouban === '5335'){
		strComment = '合えば悪くないけど、合わないと普通よりも弱い。';
	}else if( strTouban === '5346'){
		strComment = '乗り心地は良かったけど、エンジン勝率ほどの感じはない。';
	}else if( strTouban === '5376'){
		strComment = '伸びを求めていいと思う。ターン回りも悪くない。';
	}else if( strTouban === '5399'){
		strComment = '展示は乗りやすかったけど、レースではそうでもなかった。';
	}else if( strTouban === '5461'){
		strComment = 'チルト０５にして出て行くとかはないけど、普通はあると思う。';
	}else if( strTouban === '5472'){
		strComment = 'エンジンは出ている。スタートが怖い。';
	}else{
	//例外
		strComment = '';
	}
	return strComment;
}
//選手コメント当日New取得(引数 登番,順番1～4,レース番号(1走目に2走目は表示しないため、0は全表示),コメント表示=1.タイプを表示=2,レース番号を表示=3)
function funcToDayNewComment( argTouban , argOrder , argRacenum , argType )
{
	var strComment = '';
	var strTouban = argTouban;
	var strOrder = argOrder;
	var intRaceNum = argRacenum;
	var strType = argType;
	if( strTouban === '2538'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '2538'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '2538'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '2538'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3406'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3406'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3406'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3406'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3538'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3538'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3538'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3538'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3572'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3572'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3572'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3572'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3613'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3613'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3613'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3613'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3704'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3704'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3704'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3704'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3710'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3710'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3710'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3710'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3852'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3852'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3852'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3852'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3870'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3870'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3870'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3870'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3871'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3871'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3871'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3871'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3986'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3986'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3986'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '3986'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4043'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4043'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4043'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4043'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4067'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4067'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4067'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4067'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4240'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4240'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4240'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4240'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4252'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4252'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4252'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4252'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4389'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4389'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4389'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4389'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4397'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4397'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4397'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4397'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4467'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4467'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4467'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4467'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4485'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4485'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4485'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4485'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4516'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4516'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4516'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4516'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4639'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4639'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4639'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4639'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4648'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4648'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4648'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4648'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4664'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4664'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4664'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4664'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4665'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4665'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4665'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4665'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4739'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4739'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4739'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4739'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4857'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4857'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4857'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4857'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4953'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4953'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4953'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4953'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4957'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4957'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4957'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '4957'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5037'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5037'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5037'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5037'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5046'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5046'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5046'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5046'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5066'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5066'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5066'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5066'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5105'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5105'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5105'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5105'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5223'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5223'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5223'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5223'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5232'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5232'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5232'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5232'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5243'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5243'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5243'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5243'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5245'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5245'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5245'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5245'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5268'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5268'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5268'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5268'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5286'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5286'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5286'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5286'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5292'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5292'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5292'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5292'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5335'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5335'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5335'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5335'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5346'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5346'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5346'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5346'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5376'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5376'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5376'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5376'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5399'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5399'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5399'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5399'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5461'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5461'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5461'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5461'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5472'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5472'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5472'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else if( strTouban === '5472'){
		if( strOrder === '1'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '2'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '3'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else if( strOrder === '4'){
			if( intRaceNum >= 0){
				if( strType === '1' ){
					strComment = '';
				}else if( strType === '2' ){
					strComment = '';
				}else if( strType === '3' ){
					strComment = '0';
				}else{
					strComment = '';
				}
			}else{
				strComment = '';
			}
		}else{
			strComment = '';
		}
	}else{
	//例外
		strComment = '';
	}
	return strComment;
}
