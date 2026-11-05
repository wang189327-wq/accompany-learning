module.exports=T=>({
 GetRow:{tableName:'c9_records',primaryKey:[{task_id:'task-fixture'},{round_key:'2026-W45'}],maxVersions:1,columnsToGet:['payload']},
 PutRow:{tableName:'c9_records',primaryKey:[{task_id:'task-fixture'},{round_key:'2026-W45'}],condition:new T.Condition(T.RowExistenceExpectation.EXPECT_EXIST,new T.SingleColumnCondition('revision',T.Long.fromNumber(3),T.ComparatorType.EQUAL,false,true)),attributeColumns:[{payload:JSON.stringify({taskName:'合成作业',selfScore:8})},{revision:T.Long.fromNumber(4)}]},
 GetRange:{tableName:'c9_tasks',direction:T.Direction.FORWARD,maxVersions:1,columnsToGet:['payload'],inclusiveStartPrimaryKey:[{task_id:T.INF_MIN}],exclusiveEndPrimaryKey:[{task_id:T.INF_MAX}],limit:100}
});
