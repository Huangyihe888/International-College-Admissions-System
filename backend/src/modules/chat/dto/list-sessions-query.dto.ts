import { PaginationDto } from "../../../common/dto/pagination.dto";

/**
 * GET /chat/sessions 的 query 透传分页 DTO。
 * 当前没有额外的 visitorId 过滤字段:visitorId 来自 cookie / header,不能信任客户端。
 */
export class ListSessionsQueryDto extends PaginationDto {}
