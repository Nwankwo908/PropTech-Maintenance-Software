import {it,expect} from 'vitest'
import {serialReviewInput} from './serialReview.ts'
it('accepts only an explicit known serial or explicit unknown choice',()=>{
 expect(serialReviewInput({serial:' X132753655 ',unknown:false})).toEqual({serial:'X132753655',unknown:false});
 expect(serialReviewInput({serial:'guess',unknown:true})).toEqual({serial:null,unknown:true});
 for(const body of [{serial:'X'}, {unknown:false,serial:''},{unknown:false,serial:'A / B'},{unknown:false,serial:'A\nB'},{unknown:false,serial:'?'}])expect(()=>serialReviewInput(body)).toThrow();
});
