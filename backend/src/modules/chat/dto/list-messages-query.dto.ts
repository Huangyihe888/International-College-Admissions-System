import { PaginationDto } from "../../../common/dto/pagination.dto";

/**
 * GET /chat/sessions/:id/messages 的 query 透传分页 DTO。
 * 排序固定 createdAt ASC(看上下文自然顺序),不分 page 没关系,翻页时基于 createdAt 做 cursor 更稳;
 * 简化起见先用 page/pageSize,后续可换 cursor。
 */
export class ListMessagesQueryDto extends PaginationDto {}
