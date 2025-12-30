export interface MessagingPort {
  sendMessage<TMessage, TResult = void>(message: TMessage): Promise<TResult>;
}
